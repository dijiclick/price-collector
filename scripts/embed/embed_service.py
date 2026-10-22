#!/usr/bin/env python3
"""
modadrop-embed (2026-10-22): image embeddings for "Shop the look".

One process, two jobs sharing one model in memory:

  1. HTTP on 127.0.0.1:8091 (localhost only, for the look-detect job)
       POST /embed {"url": "...", "box": [ymin,xmin,ymax,xmax] | null}
         -> {"emb": [768 floats, L2-normalised], "model": "..."}
       box is 0-1000 of the photo, as Gemini returns it; the crop gets ~6%
       padding on every side before it is embedded.
       GET /health -> model, dim, backfill counters.

  2. Backfill + keep-up: every discounted, in-stock catalogue item of a type a
     look can contain gets a row in product_embeddings, Turkey first, then the
     other markets in EMBED_ORDER. A row is redone when the photo it was made
     from changes (a packshot was found, or the shop swapped the image) or it
     came from another model build. When
     nothing is left it sleeps EMBED_IDLE seconds and looks again — that loop is
     the "timer".

Requests always win over the backfill: the backfill embeds in small slices and
waits while a request is pending, so a /embed call waits at most one slice.

The model is FashionSigLIP's image tower as int8 ONNX (export_onnx.py).
Both sides — catalogue photos here and worn-item crops from model photos —
go through the same normalise(): plain studio background trimmed, so a bag
shot small on a tall white canvas fills the frame like a tight crop of the
same bag on a person does.

Env: DATABASE_URL, EMBED_MODEL_DIR (/opt/modadrop-embed/model), EMBED_THREADS (4),
EMBED_PORT (8091), EMBED_BACKFILL (1), EMBED_ORDER (TR,US,GB,…), EMBED_IDLE (600).
"""
import io
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 60_000_000

MODEL_DIR = os.environ.get("EMBED_MODEL_DIR", "/opt/modadrop-embed/model")
THREADS = int(os.environ.get("EMBED_THREADS", "4"))
PORT = int(os.environ.get("EMBED_PORT", "8091"))
BACKFILL = os.environ.get("EMBED_BACKFILL", "1") == "1"
ORDER = [c for c in os.environ.get("EMBED_ORDER", "TR,US,GB,CA,AU,DE,FR,ES,IT,NL").split(",") if c]
IDLE = int(os.environ.get("EMBED_IDLE", "600"))
FETCHERS = int(os.environ.get("EMBED_FETCHERS", "8"))
CHUNK = int(os.environ.get("EMBED_CHUNK", "1500"))  # candidates per DB query
SLICE = 8                                           # images per backfill turn on the model
# The types a worn item can map to (brief: role -> product_type).
TYPES = ["ust", "alt", "elbise", "dis-giyim", "triko", "ayakkabi", "canta", "aksesuar", "mayo"]
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)


# ---------------------------------------------------------------- model

with open(os.path.join(MODEL_DIR, "meta.json")) as f:
    META = json.load(f)
MODEL_NAME = META["name"]
DIM = META["dim"]
SIZE = META["size"]


def make_session(threads):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    # Every run is one image (see embed_one); the arena would only hold memory.
    so.enable_cpu_mem_arena = False
    return ort.InferenceSession(os.path.join(MODEL_DIR, META["file"]), so, providers=["CPUExecutionProvider"])


SESSION = make_session(THREADS)


def embed_one(x, session=None):
    """x: float32 3×S×S -> DIM, L2-normalised.

    ONE image per run, always. The int8 model quantises activations with a
    scale taken over the whole input tensor, so a photo embedded in a batch of
    8 comes out different from the same photo alone: cosine 0.996 mean / 0.992
    worst on 16 catalogue photos (2026-10-22). Batch 1 everywhere — /embed,
    the backfill here and embed_batch.py on GitHub runners — gives the same
    vector for the same photo whatever else is being embedded (thread count
    does not matter: 1.000000)."""
    out = (session or SESSION).run(None, {"x": x[None]})[0][0]
    return out / max(float(np.linalg.norm(out)), 1e-12)

_infer_lock = threading.Lock()
_waiting = 0           # HTTP requests waiting for the model
_waiting_lock = threading.Lock()


def infer(batch, priority):
    """batch: float32 N×3×S×S -> N×DIM, L2-normalised (each image on its own, see embed_one)."""
    global _waiting
    if priority:
        with _waiting_lock:
            _waiting += 1
        try:
            with _infer_lock:
                out = [embed_one(x) for x in batch]
        finally:
            with _waiting_lock:
                _waiting -= 1
    else:
        while _waiting > 0:
            time.sleep(0.05)
        with _infer_lock:
            out = [embed_one(x) for x in batch]
    return np.stack(out)


# ---------------------------------------------------------------- images

def photo_at(url, width):
    """Ask the shop's CDN for a smaller copy (port of apps/mobile photoAt)."""
    try:
        u = urllib.parse.urlsplit(url)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
        host = u.hostname or ""
        if host == "image.hm.com":
            q["imwidth"] = str(width)
        elif host.endswith("ktnimg2.mncdn.com") and u.path.startswith("/products/"):
            return f"{u.scheme}://{u.netloc}/mnresize/{width}/-{u.path}" + (f"?{u.query}" if u.query else "")
        elif re.match(r"^static\.(zara|bershka|e-stradivarius|massimodutti|pullandbear|oysho)\.net$", host):
            q["w"] = str(width)
        elif host == "images.ctfassets.net":
            q["w"] = str(width)
            q.setdefault("fm", "jpg")
            q.setdefault("q", "80")
        elif "wid" in q and "hei" in q and "mango" in host:
            q["wid"] = str(width)
            q["hei"] = str(round(width * 1.4))
        else:
            return url
        return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(q), u.fragment))
    except Exception:
        return url


def fetch(url, width):
    if not re.match(r"^https?://", url or ""):
        raise ValueError("not an http(s) url")
    src = photo_at(url, width)
    req = urllib.request.Request(src, headers={"User-Agent": UA, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read(25_000_000)
    except Exception:
        if src == url:
            raise
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
            data = r.read(25_000_000)
    img = Image.open(io.BytesIO(data))
    # Shops without a resizing CDN serve 3-8k originals. Decode JPEGs at a
    # reduced DCT scale and shrink the rest at once: eight fetchers holding
    # 60 MB bitmaps each pushed the service into its memory cap (2026-10-22).
    cap = int(width * 1.6)
    if img.format == "JPEG":
        img.draft("RGB", (cap, cap))
    img.thumbnail((cap, cap * 2))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    return img.convert("RGB")


def crop_box(img, box, pad=0.06):
    ymin, xmin, ymax, xmax = [float(v) for v in box]
    W, H = img.size
    y0, y1 = sorted((ymin, ymax))
    x0, x1 = sorted((xmin, xmax))
    bh, bw = (y1 - y0) / 1000 * H, (x1 - x0) / 1000 * W
    if bh < 4 or bw < 4:
        raise ValueError("box too small")
    l = max(0, x0 / 1000 * W - pad * bw)
    t = max(0, y0 / 1000 * H - pad * bh)
    r = min(W, x1 / 1000 * W + pad * bw)
    b = min(H, y1 / 1000 * H + pad * bh)
    return img.crop((int(l), int(t), int(round(r)), int(round(b))))


def trim_plain(img, margin=0.04):
    """Cut a plain studio background down to the item, keeping a small margin.
    Photos without a plain border (streets, coloured sets) come back as they are."""
    a = np.asarray(img.resize((min(img.width, 256), max(1, round(img.height * min(img.width, 256) / img.width)))), dtype=np.int16)
    h, w = a.shape[:2]
    if h < 16 or w < 16:
        return img
    border = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3), a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    if np.abs(border - bg).max(axis=1).mean() > 10:
        return img
    fg = np.abs(a - bg).max(axis=2) > 28
    rows, cols = np.where(fg.sum(axis=1) > max(1, w * 0.004))[0], np.where(fg.sum(axis=0) > max(1, h * 0.004))[0]
    if len(rows) == 0 or len(cols) == 0:
        return img
    t, b, l, r = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    if (b - t) * (r - l) > 0.9 * h * w or (b - t) * (r - l) < 0.005 * h * w:
        return img
    m = margin * max(b - t, r - l)
    sx, sy = img.width / w, img.height / h
    return img.crop((int(max(0, l - m) * sx), int(max(0, t - m) * sy),
                     int(min(w, r + m) * sx), int(min(h, b + m) * sy)))


def to_tensor(img):
    """FashionSigLIP preprocessing: bicubic resize to S×S (no crop), [-1, 1]."""
    x = np.asarray(img.resize((SIZE, SIZE), Image.BICUBIC), dtype=np.float32) / 255.0
    return ((x - 0.5) / 0.5).transpose(2, 0, 1)


def prepare(url, box=None):
    if box is not None:
        img = crop_box(fetch(url, 1200), box)
    else:
        img = fetch(url, 480)
    return to_tensor(trim_plain(img))


# ---------------------------------------------------------------- HTTP

STATS = {"started": time.time(), "requests": 0, "request_errors": 0, "backfill_done": 0,
         "backfill_failed": 0, "backfill_rate_per_min": 0.0, "backfill_state": "starting", "remaining": None}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            return self._send(200, {"ok": True, "model": MODEL_NAME, "dim": DIM, **STATS})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/embed":
            return self._send(404, {"error": "not found"})
        STATS["requests"] += 1
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
            url, box = req.get("url"), req.get("box")
            if not isinstance(url, str) or not re.match(r"^https?://", url):
                return self._send(400, {"error": "url must be http(s)"})
            if box is not None and not (isinstance(box, list) and len(box) == 4
                                        and all(isinstance(v, (int, float)) for v in box)):
                return self._send(400, {"error": "box must be [ymin,xmin,ymax,xmax] 0-1000 or null"})
        except Exception as e:
            STATS["request_errors"] += 1
            return self._send(400, {"error": f"bad request: {e}"})
        try:
            x = prepare(url, box)
        except Exception as e:
            STATS["request_errors"] += 1
            return self._send(502, {"error": f"image: {type(e).__name__}: {e}"[:300]})
        emb = infer(x[None], priority=True)[0]
        self._send(200, {"emb": [round(float(v), 6) for v in emb], "model": MODEL_NAME})


# ---------------------------------------------------------------- backfill

CANDIDATES = """
SELECT c.id, COALESCE(p.url, c.image_url) AS url
  FROM catalogue_items c
  LEFT JOIN product_packshots p ON p.product_id = c.id AND p.url IS NOT NULL
  LEFT JOIN product_embeddings e ON e.product_id = c.id
  LEFT JOIN embed_failures f ON f.product_id = c.id
        AND f.image_url = COALESCE(p.url, c.image_url)
        AND f.failed_at > now() - interval '3 days'
 WHERE c.in_stock AND c.pct > 0 AND c.image_url IS NOT NULL
   AND c.product_type = ANY(%(types)s)
   AND (e.product_id IS NULL OR e.image_url IS DISTINCT FROM COALESCE(p.url, c.image_url)
        OR e.model <> %(model)s)
   AND f.product_id IS NULL
   AND mod(c.id, %(nshards)s) = %(shard)s AND c.id <> ALL(%(skip)s::int[])
 ORDER BY COALESCE(array_position(%(order)s::text[], c.country), 999), c.country,
          (e.product_id IS NULL) DESC, c.id DESC
 LIMIT %(limit)s
"""
REMAINING = """
SELECT count(*) FROM catalogue_items c
  LEFT JOIN product_packshots p ON p.product_id = c.id AND p.url IS NOT NULL
  LEFT JOIN product_embeddings e ON e.product_id = c.id
 WHERE c.in_stock AND c.pct > 0 AND c.image_url IS NOT NULL AND c.product_type = ANY(%(types)s)
   AND (e.product_id IS NULL OR e.image_url IS DISTINCT FROM COALESCE(p.url, c.image_url)
        OR e.model <> %(model)s)
"""
UPSERT = """
INSERT INTO product_embeddings (product_id, image_url, emb, model, embedded_at)
VALUES (%s, %s, %s::vector, %s, now())
ON CONFLICT (product_id) DO UPDATE
   SET image_url = EXCLUDED.image_url, emb = EXCLUDED.emb, model = EXCLUDED.model, embedded_at = now()
"""
FAIL = """
INSERT INTO embed_failures (product_id, image_url, error) VALUES (%s, %s, %s)
ON CONFLICT (product_id) DO UPDATE
   SET tries = CASE WHEN embed_failures.image_url = EXCLUDED.image_url THEN embed_failures.tries + 1 ELSE 1 END,
       image_url = EXCLUDED.image_url, error = EXCLUDED.error, failed_at = now()
"""


def vec(v):
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def connect():
    import psycopg
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, application_name="modadrop-embed")
    conn.execute("SET lock_timeout = '5s'")
    conn.execute("SET statement_timeout = '180s'")
    return conn


def safe_prepare(row):
    pid, url = row
    try:
        return pid, url, prepare(url), None
    except Exception as e:
        return pid, url, None, f"{type(e).__name__}: {e}"[:300]


def backfill_loop():
    pool = ThreadPoolExecutor(FETCHERS)
    conn = None
    window = []  # (time, n) for the rate
    last_remaining = 0
    while True:
        try:
            if conn is None or conn.closed:
                conn = connect()
            if time.time() - last_remaining > 900:
                STATS["remaining"] = conn.execute(REMAINING, {"types": TYPES, "model": MODEL_NAME}).fetchone()[0]
                last_remaining = time.time()
            rows = conn.execute(CANDIDATES, {"types": TYPES, "order": ORDER, "limit": CHUNK, "model": MODEL_NAME,
                                             "nshards": 1, "shard": 0, "skip": []}).fetchall()
            if not rows:
                STATS["backfill_state"] = "idle"
                STATS["remaining"] = 0
                time.sleep(IDLE)
                continue
            STATS["backfill_state"] = "running"
            ok = bad = 0
            t0 = time.time()
            # Downloads run ahead on the fetcher threads (at most AHEAD photos
            # decoded and waiting) while the model embeds slice by slice, so
            # the network and the CPU overlap; requests can cut in per slice.
            AHEAD = SLICE * 12
            futs = [pool.submit(safe_prepare, r) for r in rows[:AHEAD]]
            nxt = len(futs)
            k = 0
            while k < len(futs):
                part = [f.result() for f in futs[k:k + SLICE]]
                for f in range(k, min(k + SLICE, len(futs))):
                    futs[f] = None  # free the decoded photo
                k += SLICE
                while nxt < len(rows) and nxt < k + AHEAD:
                    futs.append(pool.submit(safe_prepare, rows[nxt]))
                    nxt += 1
                good = [p for p in part if p[2] is not None]
                for p in part:
                    if p[2] is None:
                        conn.execute(FAIL, (p[0], p[1], p[3]))
                        bad += 1
                if good:
                    embs = infer(np.stack([p[2] for p in good]), priority=False)
                    with conn.cursor() as cur:
                        cur.executemany(UPSERT, [(p[0], p[1], vec(e), MODEL_NAME) for p, e in zip(good, embs)])
                    ok += len(good)
                STATS["backfill_done"] += len(good)
                STATS["backfill_failed"] += len(part) - len(good)
                now = time.time()
                window.append((now, len(part)))
                window = [w for w in window if now - w[0] < 600]
                span = max(60.0, now - window[0][0])
                STATS["backfill_rate_per_min"] = round(sum(w[1] for w in window) / span * 60, 1)
            dt = time.time() - t0
            if STATS["remaining"]:
                STATS["remaining"] = max(0, STATS["remaining"] - ok)
            log(f"backfill: {ok} embedded, {bad} failed in {dt:.0f}s "
                f"({len(rows) / max(dt, 1e-3) * 60:.0f}/min), ~{STATS['remaining']} left")
        except Exception:
            log("backfill error:", traceback.format_exc().strip().splitlines()[-1])
            traceback.print_exc()
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
            time.sleep(60)


def main():
    log(f"model {MODEL_NAME} dim {DIM} threads {THREADS}; http 127.0.0.1:{PORT}; backfill {'on' if BACKFILL else 'off'}")
    if BACKFILL:
        threading.Thread(target=backfill_loop, daemon=True, name="backfill").start()
    else:
        STATS["backfill_state"] = "off"
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    srv.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--embed":
        # Debug: embed a url (and optional box JSON) and print the first values.
        box = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
        e = infer(prepare(sys.argv[2], box)[None], priority=True)[0]
        print(MODEL_NAME, DIM, [round(float(v), 4) for v in e[:8]])
    else:
        main()
