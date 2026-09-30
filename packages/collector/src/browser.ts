import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * GET a page through a real headless browser — `browser_fetch.py`, a Scrapling
 * session kept open for the whole run.
 *
 * Only for sites whose bot challenge a plain request cannot pass. shop.mango.com
 * (Vercel Security Checkpoint since 2026-09-28) answers GitHub's runners with a
 * 429 challenge page to Node's fetch, curl and curl_cffi-style TLS impersonation
 * alike; a browser solves it once and then loads every page. It costs ~15s for
 * the first page and a few seconds per page after, so use it for the handful
 * of HTML pages that need it, not for JSON APIs.
 *
 * Needs `python3` with `scrapling[fetchers]` and its browser installed (see the
 * collector workflows). `SCRAPLING_PYTHON` points at another interpreter, e.g.
 * a venv.
 */
const SCRIPT = fileURLToPath(new URL("./browser_fetch.py", import.meta.url));

interface Reply {
  status?: number;
  html?: string;
  error?: string;
}

let child: ChildProcessWithoutNullStreams | undefined;
let waiting: Array<(r: Reply) => void> = [];
/** Requests go one at a time: one browser tab, one challenge cookie. */
let queue: Promise<unknown> = Promise.resolve();

function start(): ChildProcessWithoutNullStreams {
  const proc = spawn(process.env.SCRAPLING_PYTHON ?? "python3", [SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  createInterface({ input: proc.stdout }).on("line", (line) => {
    let reply: Reply;
    try {
      reply = JSON.parse(line);
    } catch {
      reply = { error: `unparseable reply: ${line.slice(0, 200)}` };
    }
    waiting.shift()?.(reply);
  });
  let stderrTail = "";
  proc.stderr.on("data", (d) => (stderrTail = (stderrTail + d).slice(-2000)));
  const fail = (why: string) => {
    child = undefined;
    const pending = waiting;
    waiting = [];
    for (const resolve of pending) resolve({ error: `${why}\n${stderrTail}` });
  };
  proc.on("error", (err) => fail(`browser helper failed to start: ${err.message}`));
  proc.on("exit", (code) => fail(`browser helper exited (${code})`));
  // Idle, the helper must not hold the run open: the collector ends by
  // draining its event loop, not with process.exit. stdin closing on exit is
  // what shuts the browser down.
  idle(proc);
  return proc;
}

function idle(proc: ChildProcessWithoutNullStreams) {
  proc.unref();
  for (const s of [proc.stdin, proc.stdout, proc.stderr]) (s as any).unref?.();
}

function busy(proc: ChildProcessWithoutNullStreams) {
  proc.ref();
  for (const s of [proc.stdin, proc.stdout, proc.stderr]) (s as any).ref?.();
}

function request(url: string): Promise<Reply> {
  child ??= start();
  const proc = child;
  return new Promise<Reply>((resolve) => {
    busy(proc);
    waiting.push((r) => {
      if (waiting.length === 0) idle(proc);
      resolve(r);
    });
    proc.stdin.write(JSON.stringify({ url }) + "\n");
  });
}

export async function browserText(url: string): Promise<string> {
  const reply = (await (queue = queue.then(
    () => request(url),
    () => request(url),
  ))) as Reply;
  if (reply.error) throw new Error(`browser fetch ${url}: ${reply.error}`);
  if (!reply.status || reply.status < 200 || reply.status >= 300) {
    throw new Error(`HTTP ${reply.status} for ${url}`);
  }
  return reply.html ?? "";
}
