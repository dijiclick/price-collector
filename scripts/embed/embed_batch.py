#!/usr/bin/env python3
"""
embed_batch (2026-10-22): the modadrop-embed backfill as a one-off batch job,
run on GitHub Actions runners by embed.yml in the public collector repo.

The main box embeds ~190 photos a minute next to Postgres; ~870k were left, three
days of work. Twenty free runners split the rows by id (id % shards = shard)
and finish in hours.

Same code path as the service, on purpose — vectors from here and from
POST /embed must be interchangeable:
  - it imports embed_service: the same fetch (CDN resize, decode shrink),
    trim_plain, to_tensor, the same candidate query and order (Turkey first),
    the same UPSERT and the same `model` value;
  - the ONNX file is the one the box runs, byte for byte (embed.yml downloads
    it from the repo's release and checks its sha256);
  - one image per run (embed_one): the int8 model's activation scale is taken
    over the whole batch, so batching would change the vector.
Check after a run: re-embed random rows it wrote through the box's /embed;
cosine must be >= 0.999.

Different from the service, deliberately:
  - only rows with id % SHARDS == SHARD, so runners never pick the same row;
  - a photo that fails here is NOT written to embed_failures: a shop that
    refuses GitHub's IPs may answer the main box, whose own backfill then
    gets it. It is only skipped for the rest of this run;
  - one ONNX session per core (one thread each) instead of one 4-thread session;
  - it stops when nothing is left in its shard or at --minutes.

  EMBED_MODEL_DIR=model python embed_batch.py --shards 20 --shard 3 --minutes 290

Env: DATABASE_URL, EMBED_MODEL_DIR, EMBED_WORKERS (all cores), EMBED_FETCHERS (24).
"""
import argparse
import os
import sys
import time
import urllib.parse
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from queue import Queue

# The service builds its session at import; here every session gets one thread.
os.environ.setdefault("EMBED_THREADS", "1")
os.environ.setdefault("EMBED_BACKFILL", "0")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import embed_service as es  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--shards", type=int, default=1)
ap.add_argument("--shard", type=int, default=0)
ap.add_argument("--minutes", type=float, default=290)
ap.add_argument("--chunk", type=int, default=5000)
args = ap.parse_args()
assert 0 <= args.shard < args.shards

WORKERS = int(os.environ.get("EMBED_WORKERS") or os.cpu_count() or 4)
FETCHERS = max(WORKERS, int(os.environ.get("EMBED_FETCHERS", "24")))
AHEAD = FETCHERS * 3   # rows submitted and not yet written
FLUSH = 64             # rows per INSERT transaction
DEADLINE = time.time() + args.minutes * 60

SESSIONS = Queue()
SESSIONS.put(es.SESSION)
for _ in range(WORKERS - 1):
    SESSIONS.put(es.make_session(1))


def work(row):
    pid, url, x, err = es.safe_prepare(row)
    if x is None:
        return pid, url, None, err
    s = SESSIONS.get()
    try:
        return pid, url, es.embed_one(x, s), None
    finally:
        SESSIONS.put(s)


def connect():
    import psycopg
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True,
                           application_name=f"modadrop-embed-gh-{args.shard}")
    conn.execute("SET lock_timeout = '5s'")
    conn.execute("SET statement_timeout = '180s'")
    return conn


def main():
    es.log(f"shard {args.shard}/{args.shards}: model {es.MODEL_NAME} dim {es.DIM}, "
           f"{WORKERS} sessions, {FETCHERS} fetchers, {args.minutes:.0f} min")
    conn = connect()
    pool = ThreadPoolExecutor(FETCHERS)
    skip = set()          # failed in this run: not retried, not recorded
    hosts = Counter()     # failures by shop host
    done = failed = 0
    sample = []           # a few ids written, for checking them against /embed
    t_start = last_log = time.time()
    buf = []

    def flush():
        nonlocal done
        if not buf:
            return
        with conn.transaction(), conn.cursor() as cur:
            cur.executemany(es.UPSERT, [(pid, url, es.vec(e), es.MODEL_NAME) for pid, url, e in buf])
        done += len(buf)
        if len(sample) < 5:
            sample.extend(pid for pid, _, _ in buf[: 5 - len(sample)])
        buf.clear()

    while time.time() < DEADLINE:
        t_q = time.time()
        rows = conn.execute(es.CANDIDATES, {
            "types": es.TYPES, "order": es.ORDER, "limit": args.chunk, "model": es.MODEL_NAME,
            "nshards": args.shards, "shard": args.shard, "skip": sorted(skip)}).fetchall()
        es.log(f"{len(rows)} candidates ({time.time() - t_q:.1f}s query)"
               + (f", first {rows[0][0]}" if rows else ""))
        if not rows:
            break
        it = iter(rows)
        pending = set()
        while True:
            while len(pending) < AHEAD and time.time() < DEADLINE:
                r = next(it, None)
                if r is None:
                    break
                pending.add(pool.submit(work, r))
            if not pending:
                break
            fin, pending = wait(pending, return_when=FIRST_COMPLETED)
            for f in fin:
                pid, url, e, err = f.result()
                if e is None:
                    skip.add(pid)
                    failed += 1
                    hosts[urllib.parse.urlsplit(url).hostname or "?"] += 1
                else:
                    buf.append((pid, url, e))
            if len(buf) >= FLUSH:
                flush()
            now = time.time()
            if now - last_log >= 60:
                last_log = now
                es.log(f"{done} embedded, {failed} failed, {done / (now - t_start) * 60:.0f}/min"
                       + (f"; sample ids {sample}" if sample else ""))
        flush()
    flush()
    mins = (time.time() - t_start) / 60
    es.log(f"finished: {done} embedded, {failed} failed in {mins:.0f} min ({done / max(mins, 1e-3):.0f}/min); "
           f"sample ids {sample}")
    if hosts:
        es.log("failures by host: " + ", ".join(f"{h} {n}" for h, n in hosts.most_common(12)))
    pool.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
