"""
Fetch pages through a real headless browser (Scrapling), for sites that put a
JavaScript bot challenge in front of datacenter IPs.

Why a browser: shop.mango.com sits behind Vercel's Security Checkpoint since
2026-09-28. From GitHub's runners (and Hetzner) every plain request — Node's
fetch, curl, and TLS impersonators like curl_cffi/impit alike — gets a 429
challenge page. A browser solves the challenge once, gets a cookie, and every
later page in the same session loads normally (measured 2026-09-30 from
Hetzner: 200 with the full sale list, three fetches in a row).

Protocol, driven by packages/collector/src/browser.ts: one JSON request per
line on stdin, {"url": ...}; one JSON reply per line on stdout,
{"status": int, "html": str} or {"error": str}. The browser stays open for the
life of the process, so the challenge is paid once per collector run. EOF on
stdin (the collector exiting) closes it.
"""
import json
import os
import sys

# The protocol owns fd 1. Anything else that writes there — Scrapling's
# logger, the browser, a stray print — would corrupt a reply line, so park the
# real stdout and point fd 1 at stderr before importing anything.
_out = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

from scrapling.fetchers import StealthySession  # noqa: E402

CHALLENGE_MARKERS = ("Vercel Security Checkpoint", "vercel-challenge")
# The first request of a session lands on the challenge; the page solves it and
# reloads itself. Waiting this long after load has been enough every time.
SOLVE_WAIT_MS = int(os.environ.get("BROWSER_SOLVE_WAIT_MS", "12000"))


def body_of(page) -> str:
    body = page.body
    return body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)


def challenged(status: int, html: str) -> bool:
    return status in (403, 429) or any(m in html for m in CHALLENGE_MARKERS)


def fetch(session, url: str) -> dict:
    page = session.fetch(url, disable_resources=True)
    html = body_of(page)
    tries = 0
    while challenged(page.status, html) and tries < 2:
        tries += 1
        page = session.fetch(url, disable_resources=True, wait=SOLVE_WAIT_MS)
        html = body_of(page)
    return {"status": page.status, "html": html}


def reply(msg: dict) -> None:
    _out.write(json.dumps(msg) + "\n")
    _out.flush()


def main() -> None:
    with StealthySession(headless=True) as session:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                reply(fetch(session, json.loads(line)["url"]))
            except Exception as err:  # one bad page must not kill the session
                reply({"error": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    main()
