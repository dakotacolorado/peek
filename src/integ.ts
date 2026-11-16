/**
 * `npm run integ`: checks a running peek end to end, given PEEK_URL and
 * PEEK_TOKEN. It uploads the fixtures, lists them, fetches a range, writes
 * through MCP inline and by upload URL, and deletes everything it made, also
 * when a check fails. Exits non-zero on any failure.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const base = process.env.PEEK_URL?.replace(/\/+$/, "");
const token = process.env.PEEK_TOKEN;
if (!base || !token) {
  process.stderr.write("integ: set PEEK_URL (the instance's address) and PEEK_TOKEN (a token it takes)\n");
  process.exit(2);
}

interface Asset {
  id: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  repo: string | null;
  pr: number | null;
  link: string;
  fileUrl: string;
}

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const auth = { authorization: `Bearer ${token}`, "x-actor": "peek-integ" };
// Each run has a repository of its own, so its listing holds only what it made.
const run = randomBytes(4).toString("hex");
const repo = `peek-integ/run-${run}`;
const pr = 1;
const made = new Set<string>();
let checks = 0;

function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
  checks++;
  process.stdout.write(`ok ${checks} - ${what}\n`);
}

async function json<T>(res: Response, status: number, what: string): Promise<T> {
  const text = await res.text();
  check(res.status === status, `${what}: ${status}${res.status === status ? "" : ` (answered ${res.status}: ${text.slice(0, 300)})`}`);
  return JSON.parse(text) as T;
}

/** Calls an MCP tool, statelessly, and answers its JSON. */
async function tool<T>(name: string, args: unknown): Promise<{ isError: boolean; json: T }> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await json<{ result: { isError?: boolean; content: { text: string }[] } }>(res, 200, `MCP ${name} answers`);
  return { isError: body.result.isError === true, json: JSON.parse(body.result.content[0]!.text) as T };
}

async function put(name: string, type: string): Promise<{ asset: Asset; bytes: Uint8Array }> {
  const bytes = fixture(name);
  const query = new URLSearchParams({ name, repo, pr: String(pr), tags: `integ,run-${run}` });
  const res = await fetch(`${base}/api/assets?${query}`, { method: "PUT", headers: { ...auth, "content-type": type }, body: bytes });
  const asset = await json<Asset>(res, 201, `PUT ${name}`);
  made.add(asset.id);
  check(asset.size === bytes.length && asset.sha256 === sha(bytes), `${name} is kept whole (${bytes.length} bytes, sha256 matches)`);
  check(asset.contentType === type, `${name} is ${type}`);
  check(asset.link.endsWith(`/a/${asset.id}`) && asset.fileUrl.includes(`/f/${asset.id}/`), `${name} answers its link and fileUrl`);
  return { asset, bytes };
}

async function main() {
  const health = await json<{ ok: boolean; commit: string }>(await fetch(`${base}/health`), 200, "GET /health");
  check(health.ok && health.commit, `health names commit ${health.commit}`);

  check((await fetch(`${base}/api/assets`)).status === 401, "listing without a token is refused 401");

  const png = await put("pixel.png", "image/png");
  const mp4 = await put("clip.mp4", "video/mp4");
  const mp3 = await put("tone.mp3", "audio/mpeg");

  const list = await json<{ assets: Asset[] }>(await fetch(`${base}/api/assets?${new URLSearchParams({ repo, pr: String(pr) })}`, { headers: auth }), 200, "GET /api/assets by repo and pr");
  check(
    JSON.stringify(list.assets.map((a) => a.id)) === JSON.stringify([mp3.asset.id, mp4.asset.id, png.asset.id]),
    "the three list by repo and pr, newest first",
  );
  const videos = await json<{ assets: Asset[] }>(await fetch(`${base}/api/assets?${new URLSearchParams({ repo, contentType: "video/" })}`, { headers: auth }), 200, "GET /api/assets by contentType");
  check(videos.assets.length === 1 && videos.assets[0]!.id === mp4.asset.id, "only the MP4 lists as video/");

  const whole = await fetch(mp4.asset.fileUrl, { headers: auth });
  check(whole.status === 200 && whole.headers.get("accept-ranges") === "bytes", "the MP4 answers 200 with Accept-Ranges: bytes");
  check(sha(new Uint8Array(await whole.arrayBuffer())) === mp4.asset.sha256, "the MP4's bytes are what was uploaded");
  const ranged = await fetch(mp4.asset.fileUrl, { headers: { ...auth, range: "bytes=100-499" } });
  check(ranged.status === 206, "a range of the MP4 answers 206");
  check(ranged.headers.get("content-range") === `bytes 100-499/${mp4.bytes.length}`, `with Content-Range bytes 100-499/${mp4.bytes.length}`);
  check(Buffer.from(await ranged.arrayBuffer()).equals(Buffer.from(mp4.bytes.subarray(100, 500))), "and just those bytes");
  check((await fetch(mp4.asset.fileUrl)).status === 401, "the file without a token or session is refused 401");

  const inline = await tool<Asset>("upload_asset", { name: "inline.png", content: Buffer.from(png.bytes).toString("base64"), repo, pr, title: "Inline upload" });
  check(!inline.isError, "MCP upload_asset with content stores it");
  made.add(inline.json.id);
  check(inline.json.sha256 === png.asset.sha256 && inline.json.contentType === "image/png", "the inline upload is the PNG, image/png");
  check(inline.json.link.endsWith(`/a/${inline.json.id}`), "and answers its link");

  const ticket = await tool<{ id: string; link: string; uploadUrl: string; curl: string }>("upload_asset", { name: "by-url.mp3", repo, pr });
  check(!ticket.isError && ticket.json.uploadUrl && ticket.json.curl.includes(ticket.json.uploadUrl), "MCP upload_asset without content answers an uploadUrl and its curl");
  check(!ticket.json.curl.includes(token!) && !ticket.json.uploadUrl.includes(token!), "neither carries the token");
  made.add(ticket.json.id);
  const first = await fetch(ticket.json.uploadUrl, { method: "PUT", body: mp3.bytes });
  const byUrl = await json<Asset>(first, 201, "PUT to the uploadUrl with no token");
  check(byUrl.id === ticket.json.id && byUrl.sha256 === mp3.asset.sha256 && byUrl.contentType === "audio/mpeg", "it is the asset the ticket named, the MP3");
  const second = await fetch(ticket.json.uploadUrl, { method: "PUT", body: mp3.bytes });
  check(second.status === 403, `a second use of the uploadUrl is refused (answered ${second.status})`);

  const listed = await tool<{ assets: Asset[] }>("list_assets", { repo, pr });
  check(!listed.isError && listed.json.assets.length === 5, "MCP list_assets lists all five");

  const all = await json<{ assets: Asset[] }>(await fetch(`${base}/api/assets?${new URLSearchParams({ repo })}`, { headers: auth }), 200, "GET /api/assets by repo");
  for (const a of all.assets) made.add(a.id);
}

async function cleanup() {
  for (const id of made) {
    const res = await fetch(`${base}/api/assets/${id}`, { method: "DELETE", headers: auth });
    if (res.status !== 200 && res.status !== 404) throw new Error(`DELETE ${id} answered ${res.status}`);
    check((await fetch(`${base}/api/assets/${id}`, { headers: auth })).status === 404, `${id} is deleted`);
  }
  const left = (await (await fetch(`${base}/api/assets?${new URLSearchParams({ repo })}`, { headers: auth })).json()) as { assets: Asset[] };
  check(left.assets.length === 0, "nothing this run made is left");
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  process.stdout.write(`not ok - ${(err as Error).message}\n`);
}
try {
  await cleanup();
} catch (err) {
  failed = true;
  process.stdout.write(`not ok - cleanup: ${(err as Error).message}\n`);
}
process.stdout.write(failed ? "integ: failed\n" : `integ: passed ${checks} checks against ${base}\n`);
process.exit(failed ? 1 : 0);
