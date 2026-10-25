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

  3. Look photos (2026-10-24): every look's model photo (look_items.photo_url)
     embedded WHOLE and scored zero-shot against the prompt ensembles in
     model/prompts.json (export_text.py: FashionSigLIP's text tower) — does a
     person wear the product (a margin, see score_photo), and how likely each
     occasion is → look_photos.
     Looks the feed can show first, Turkey first. A changed prompt file only
     re-scores the stored vectors.

Requests always win over the backfill: the backfill embeds in small slices and
waits while a request is pending, so a /embed call waits at most one slice.

The model is FashionSigLIP's image tower as int8 ONNX (export_onnx.py).
Both sides — catalogue photos here and worn-item crops from model photos —
go through the same normalise(): plain studio background trimmed, so a bag
shot small on a tall white canvas fills the frame like a tight crop of the
same bag on a person does.

Env: DATABASE_URL, EMBED_MODEL_DIR (/opt/modadrop-embed/model), EMBED_THREADS (4),
EMBED_PORT (8091), EMBED_BACKFILL (1), EMBED_ORDER (TR,US,GB,…), EMBED_IDLE (600),
EMBED_LOOKS (1: score look photos).
"""
import gzip
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
LOOKS = os.environ.get("EMBED_LOOKS", "1") == "1"
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
    req = urllib.request.Request(src, headers={"User-Agent": UA, "Accept": "image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read(25_000_000)
    except Exception:
        if src == url:
            raise
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
            data = r.read(25_000_000)
    # mncdn (Loft, Yargıcı…) gzips image bodies whatever Accept-Encoding says,
    # and urllib does not undo Content-Encoding (2026-10-24: 520 looks unreadable).
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
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
         "backfill_failed": 0, "backfill_rate_per_min": 0.0, "backfill_state": "starting", "remaining": None,
         "looks_scored": 0, "looks_failed": 0, "looks_state": "starting"}


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


# ---------------------------------------------------------------- look photos

def load_prompts():
    """model/prompts.json -> per gender a class-prototype matrix, plus the person pair. None when missing."""
    try:
        with open(os.path.join(MODEL_DIR, "prompts.json")) as f:
            P = json.load(f)
    except FileNotFoundError:
        return None

    def proto(vs):
        m = np.mean(np.asarray(vs, dtype=np.float32), axis=0)
        return m / max(float(np.linalg.norm(m)), 1e-12)

    occ = P["vecs"]["occasions"]
    classes = list(occ)
    by_gender = {}
    for g in ("kadin", "erkek", None):
        gs = [g] if g else ["kadin", "erkek"]
        by_gender[g] = np.stack([proto(sum((occ[c][x] for x in gs if x in occ[c]), [])) for c in classes])
    return {"hash": P["hash"], "scale": float(P["scale"]), "classes": classes, "by_gender": by_gender,
            "yes": np.asarray(P["vecs"]["person"]["yes"], dtype=np.float32), "no": np.asarray(P["vecs"]["person"]["no"], dtype=np.float32)}


def softmax(x, scale):
    z = np.exp(scale * (x - x.max()))
    return z / z.sum()


def score_photo(e, gender, PR):
    """A look photo's vector -> (person margin, {occasion: probability}).

    Occasions: softmax over the class prototypes at the model's own logit scale,
    the anchor's gender's prompts (both when unknown).
    Person: the best "someone wears it" prompt minus the best "no one does" prompt
    (mannequin, hanger, flat lay, a close-up of the fabric). A softmax of the two
    averages called every waist-up t-shirt shot a product photo (2026-10-24, the
    50 lowest of 12.4k looks were all people); the max-minus-max margin put the
    two dress-form photos of the 12.4k first and real people below 0.03."""
    p = softmax(PR["by_gender"].get(gender if gender in ("kadin", "erkek") else None) @ e, PR["scale"])
    person = float((PR["yes"] @ e).max() - (PR["no"] @ e).max())
    return round(person, 4), {c: round(float(v), 4) for c, v in zip(PR["classes"], p)}


# Looks without a score for their current photo, model and prompts; failed photos retried after 3 days.
LOOK_TODO = """
SELECT l.product_id, l.photo_url, p.gender,
       (lp.photo_url = l.photo_url AND lp.model = %(model)s AND lp.emb IS NOT NULL) AS have_vec
  FROM look_items l
  LEFT JOIN products p ON p.id = l.product_id
  LEFT JOIN look_photos lp ON lp.product_id = l.product_id
  LEFT JOIN look_matches m ON m.product_id = l.product_id
 WHERE l.photo_url IS NOT NULL AND jsonb_array_length(l.items) > 0
   AND (lp.product_id IS NULL OR lp.photo_url <> l.photo_url OR lp.model <> %(model)s
        OR (lp.error IS NULL AND lp.prompts IS DISTINCT FROM %(prompts)s)
        OR (lp.error IS NOT NULL AND lp.scored_at < now() - interval '3 days'))
 ORDER BY (m.n >= 2) IS TRUE DESC, (p.country = 'TR') IS TRUE DESC, l.checked_at DESC
 LIMIT %(limit)s
"""
LOOK_UPSERT = """
INSERT INTO look_photos (product_id, photo_url, emb, person, occ, prompts, model, error, scored_at)
VALUES (%s, %s, %s::vector, %s, %s::jsonb, %s, %s, %s, now())
ON CONFLICT (product_id) DO UPDATE
   SET photo_url = EXCLUDED.photo_url, emb = COALESCE(EXCLUDED.emb, CASE WHEN look_photos.photo_url = EXCLUDED.photo_url THEN look_photos.emb END),
       person = EXCLUDED.person, occ = EXCLUDED.occ, prompts = EXCLUDED.prompts, model = EXCLUDED.model,
       error = EXCLUDED.error, scored_at = now()
"""


def look_loop():
    """Score every look photo (see the module docstring, job 3). Shares the model with the backfill:
    both wait for requests, and take turns on the inference lock."""
    PR = load_prompts()
    if PR is None:
        STATS["looks_state"] = "no prompts.json"
        log("look photos: no prompts.json in", MODEL_DIR, "- run export_text.py")
        return
    pool = ThreadPoolExecutor(4)
    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = connect()
            rows = conn.execute(LOOK_TODO, {"model": MODEL_NAME, "prompts": PR["hash"], "limit": 400}).fetchall()
            if not rows:
                STATS["looks_state"] = "idle"
                time.sleep(120)
                continue
            STATS["looks_state"] = "running"
            t0, ok, bad = time.time(), 0, 0
            # Vectors already stored for this photo (only the prompts changed): re-score, no download.
            have = [r for r in rows if r[3]]
            if have:
                vecs = dict(conn.execute("SELECT product_id, emb::text FROM look_photos WHERE product_id = ANY(%s)",
                                         ([r[0] for r in have],)).fetchall())
                with conn.cursor() as cur:
                    for pid, url, gender, _ in have:
                        e = np.asarray(json.loads(vecs[pid]), dtype=np.float32)
                        person, occ = score_photo(e, gender, PR)
                        cur.execute(LOOK_UPSERT, (pid, url, None, person, json.dumps(occ), PR["hash"], MODEL_NAME, None))
                ok += len(have)
            todo = [r for r in rows if not r[3]]
            for k in range(0, len(todo), SLICE):
                part = todo[k:k + SLICE]
                prepped = list(pool.map(lambda r: safe_prepare((r[0], r[1])), part))
                good = [(r, p) for r, p in zip(part, prepped) if p[2] is not None]
                embs = infer(np.stack([p[2] for _, p in good]), priority=False) if good else []
                with conn.cursor() as cur:
                    for (r, _), e in zip(good, embs):
                        person, occ = score_photo(e, r[2], PR)
                        cur.execute(LOOK_UPSERT, (r[0], r[1], vec(e), person, json.dumps(occ), PR["hash"], MODEL_NAME, None))
                    for r, p in zip(part, prepped):
                        if p[2] is None:
                            cur.execute(LOOK_UPSERT, (r[0], r[1], None, None, None, PR["hash"], MODEL_NAME, p[3]))
                ok += len(good)
                bad += len(part) - len(good)
            STATS["looks_scored"] += ok
            STATS["looks_failed"] += bad
            log(f"look photos: {ok} scored, {bad} unreadable in {time.time() - t0:.0f}s")
        except Exception:
            log("look photos error:", traceback.format_exc().strip().splitlines()[-1])
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
    if LOOKS:
        threading.Thread(target=look_loop, daemon=True, name="looks").start()
    else:
        STATS["looks_state"] = "off"
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
