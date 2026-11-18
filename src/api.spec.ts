import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "./spec.ts";
import { ADMIN, AGENT, setup } from "./testing.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/** Signs in as the agent; answers the cookie a browser would send back. */
async function signIn(t: ReturnType<typeof setup>) {
  const res = await t.fetch("/api/session", { method: "POST", headers: t.bearer() });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  return { res, cookie, header: { cookie: cookie.split(";")[0]! } };
}

describe("auth", () => {
  it("answers 401 on every documented operation but GetHealth and PutUpload without a token or session", async () => {
    const t = setup();
    const doc = await openApiDocument();
    const open: string[] = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const url = path.replace("{id}", "q3Xv9LmT0bZk").replace("{name}", "a.png").replace("{ticket}", "x".repeat(32));
        const res = await t.fetch(url, { method: method.toUpperCase(), body: ["get", "head"].includes(method) ? null : "x" });
        if (res.status !== 401) open.push(`${op.operationId} ${res.status}`);
      }
    }
    expect(open).toEqual(["GetHealth 200", "PutUpload 403"]);
    expect((await t.fetch("/mcp", { method: "POST", json: {} })).status).toBe(401);
  });

  it("refuses a wrong token, and takes a stored one and PEEK_ADMIN_TOKEN", async () => {
    const t = setup();
    expect((await t.fetch("/api/assets", { headers: t.bearer("wrong") })).status).toBe(401);
    expect((await t.fetch("/api/assets", { headers: t.bearer(AGENT) })).status).toBe(200);
    expect((await t.fetch("/api/assets", { headers: t.bearer(ADMIN) })).status).toBe(200);
  });

  it("serves /health, the docs and the viewer's shell without a token", async () => {
    const t = setup();
    for (const path of ["/health", "/openapi.json", "/mcp.json", "/docs/api", "/docs/mcp", "/", "/a/q3Xv9LmT0bZk", "/ui/app.js", "/ui/style.css"]) expect((await t.fetch(path)).status, path).toBe(200);
  });

  it("names the build's commit on /health", async () => {
    expect(await (await setup().fetch("/health")).json()).toEqual({ ok: true, version: "0.1.0", commit: "abc123" });
  });

  it("signs a browser in with an HttpOnly, Secure, SameSite=Lax cookie that the file route and the API take", async () => {
    const t = setup();
    const asset = await t.put("a.png", bytes(10));
    const { res, cookie, header } = await signIn(t);
    expect(await res.json()).toMatchObject({ name: "agent" });
    expect(cookie).toMatch(/^peek_session=[\w-]{32}; Path=\/; Max-Age=7776000; HttpOnly; Secure; SameSite=Lax$/);
    expect((await t.fetch(new URL(asset.fileUrl).pathname, { headers: header })).status).toBe(200);
    expect((await t.fetch(`/api/assets/${asset.id}`, { headers: header })).status).toBe(200);
    expect((await t.fetch(new URL(asset.fileUrl).pathname, { headers: { cookie: "peek_session=forged" } })).status).toBe(401);
  });

  it("does not sign in by a cookie, or with no token", async () => {
    const t = setup();
    const { header } = await signIn(t);
    expect((await t.fetch("/api/session", { method: "POST", headers: header })).status).toBe(401);
    expect((await t.fetch("/api/session", { method: "POST" })).status).toBe(401);
  });

  it("refuses a write signed in by the cookie alone unless it sends x-peek: 1", async () => {
    const t = setup();
    const asset = await t.put("a.png", bytes(10));
    const { header } = await signIn(t);
    const patch = (headers: Record<string, string>) => t.fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers, json: { title: "t" } });
    expect((await patch(header)).status).toBe(403);
    expect((await patch({ ...header, "x-peek": "1" })).status).toBe(200);
  });

  it("ends a session when its token is revoked, or the browser signs out", async () => {
    const t = setup();
    const { header } = await signIn(t);
    t.store.revokeToken("agent");
    expect((await t.fetch("/api/assets", { headers: header })).status).toBe(401);
    t.store.putToken("agent", AGENT, new Date());
    const again = await signIn(t);
    const out = await t.fetch("/api/session", { method: "DELETE", headers: { ...again.header, "x-peek": "1" } });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await t.fetch("/api/assets", { headers: again.header })).status).toBe(401);
  });

  it("does not take the session cookie on the MCP server", async () => {
    const t = setup();
    const { header } = await signIn(t);
    expect((await t.fetch("/mcp", { method: "POST", headers: header, json: {} })).status).toBe(401);
  });
});

describe("PutAsset", () => {
  it("streams the body to <files>/<id>/<name> and writes its row, answering its link and fileUrl", async () => {
    const t = setup();
    const body = bytes(5000);
    const asset = await t.put("clip.mp4", body, { repo: "o/r", pr: "12", task: "75d018b6", tags: "before, mobile,before", title: "Login" });
    expect(asset).toMatchObject({ name: "clip.mp4", contentType: "video/mp4", size: 5000, sha256: sha(body), repo: "o/r", pr: 12, task: "75d018b6", tags: ["before", "mobile"], title: "Login", createdBy: "agent" });
    expect(asset.link).toBe(`http://peek.test/a/${asset.id}`);
    expect(asset.fileUrl).toBe(`http://peek.test/f/${asset.id}/clip.mp4`);
    expect(new Uint8Array(readFileSync(join(t.files, asset.id, "clip.mp4")))).toEqual(body);
    expect(t.store.asset(asset.id)).toMatchObject({ sha256: sha(body) });
    expect(readdirSync(join(t.files, ".uploads"))).toEqual([]);
  });

  it("builds links on the public URL when one is set, else the forwarded address", async () => {
    expect((await setup({ publicUrl: "https://peek.example.com" }).put("a.png", "x")).link).toMatch(/^https:\/\/peek\.example\.com\/a\//);
    const t = setup();
    const res = await t.fetch("/api/assets?name=a.png", { method: "PUT", headers: { ...t.bearer(), "x-forwarded-proto": "https", "x-forwarded-host": "host.example.com:8450" }, body: "x" });
    expect(((await res.json()) as { link: string }).link).toMatch(/^https:\/\/host\.example\.com:8450\/a\//);
  });

  it("links an asset's task on the task URL when one is set, else not", async () => {
    const linked = setup({ taskUrl: "https://ui.example.com/items/{task}" });
    expect((await linked.put("a.png", "x", { task: "75d018b6" })).taskLink).toBe("https://ui.example.com/items/75d018b6");
    expect((await linked.put("b.png", "x")).taskLink).toBeNull();
    expect((await setup().put("a.png", "x", { task: "75d018b6" })).taskLink).toBeNull();
  });

  it("takes the request's content type, else the name's", async () => {
    const t = setup();
    expect((await t.put("a.bin", "x", {}, { "content-type": "image/webp" })).contentType).toBe("image/webp");
    expect((await t.put("a.mp3", "x", {}, { "content-type": "application/octet-stream" })).contentType).toBe("audio/mpeg");
  });

  it("credits the x-actor header, else the token's name", async () => {
    const t = setup();
    expect((await t.put("a.png", "x", {}, { "x-actor": "implementer-a73568fc" })).createdBy).toBe("implementer-a73568fc");
    expect((await t.put("a.png", "x")).createdBy).toBe("agent");
  });

  it("keeps a name with spaces and unicode, and serves it by its encoded fileUrl", async () => {
    const t = setup();
    const asset = await t.put("Screen Shot ü #1.png", "x");
    expect(asset.fileUrl).toBe(`http://peek.test/f/${asset.id}/Screen%20Shot%20%C3%BC%20%231.png`);
    expect((await t.fetch(new URL(asset.fileUrl).pathname, { headers: t.bearer() })).status).toBe(200);
  });

  it("refuses an empty body, a path for a name, and a bad tag, keeping nothing", async () => {
    const t = setup();
    const put = (query: string, body: string | null) => t.fetch(`/api/assets?${query}`, { method: "PUT", headers: t.bearer(), body });
    expect((await put("name=a.png", "")).status).toBe(400);
    expect((await put("name=a.png", null)).status).toBe(400);
    expect((await put("name=..%2Fa.png", "x")).status).toBe(400);
    expect((await put("name=..", "x")).status).toBe(400);
    expect((await put(`name=a.png&tags=${"x".repeat(65)}`, "x")).status).toBe(400);
    expect((await put("name=a.png&pr=zero", "x")).status).toBe(400);
    expect(t.store.assets({ maxResults: 50 }).assets).toEqual([]);
    expect(readdirSync(t.files).filter((f) => f !== ".uploads")).toEqual([]);
  });
});

describe("ListAssets", () => {
  it("filters by every field the API takes, newest first, and pages with nextToken", async () => {
    let tick = 0;
    const t = setup({ now: () => new Date(Date.UTC(2026, 10, 15, 0, 0, tick++)) });
    const a = await t.put("a.mp4", "1", { repo: "o/r", pr: "1", tags: "x,y", task: "t1" });
    const b = await t.put("b.mp4", "2", { repo: "o/r", pr: "2", tags: "x", title: "The B side" }, { "x-actor": "someone" });
    const c = await t.put("c.png", "3", { repo: "o/s" });
    const list = async (query: Record<string, string>) => {
      const res = await t.fetch(`/api/assets?${new URLSearchParams(query)}`, { headers: t.bearer() });
      expect(res.status).toBe(200);
      return (await res.json()) as { assets: { id: string; link: string }[]; nextToken: string | null };
    };
    const ids = async (query: Record<string, string>) => (await list(query)).assets.map((x) => x.id);
    expect(await ids({})).toEqual([c.id, b.id, a.id]);
    expect(await ids({ repo: "o/r" })).toEqual([b.id, a.id]);
    expect(await ids({ repo: "o/r", pr: "1" })).toEqual([a.id]);
    expect(await ids({ task: "t1" })).toEqual([a.id]);
    expect(await ids({ tags: "x" })).toEqual([b.id, a.id]);
    expect(await ids({ tags: "x,y" })).toEqual([a.id]);
    expect(await ids({ contentType: "video/" })).toEqual([b.id, a.id]);
    expect(await ids({ createdBy: "someone" })).toEqual([b.id]);
    expect(await ids({ q: "b side" })).toEqual([b.id]);
    const first = await list({ maxResults: "2" });
    expect(first.assets.map((x) => x.id)).toEqual([c.id, b.id]);
    expect(first.assets[0]!.link).toBe(`http://peek.test/a/${c.id}`);
    const second = await list({ maxResults: "2", nextToken: first.nextToken! });
    expect(second).toMatchObject({ assets: [{ id: a.id }], nextToken: null });
    expect((await t.fetch("/api/assets?nextToken=bogus", { headers: t.bearer() })).status).toBe(400);
  });
});

describe("GetAsset, UpdateAsset and DeleteAsset", () => {
  it("gets, updates and deletes an asset, file and all", async () => {
    const t = setup();
    const asset = await t.put("a.png", "x", { repo: "o/r", pr: "3" });
    expect(await (await t.fetch(`/api/assets/${asset.id}`, { headers: t.bearer() })).json()).toEqual(asset);
    const patched = await t.fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers: t.bearer(), json: { title: "Shot", pr: null, tags: ["a", "a", "b"] } });
    expect(await patched.json()).toMatchObject({ title: "Shot", repo: "o/r", pr: null, tags: ["a", "b"], sha256: asset.sha256 });
    expect((await t.fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers: t.bearer(), json: { pr: -1 } })).status).toBe(400);
    const deleted = await t.fetch(`/api/assets/${asset.id}`, { method: "DELETE", headers: t.bearer() });
    expect(deleted.status).toBe(200);
    expect(existsSync(join(t.files, asset.id))).toBe(false);
    expect((await t.fetch(`/api/assets/${asset.id}`, { headers: t.bearer() })).status).toBe(404);
    expect((await t.fetch(new URL(asset.fileUrl).pathname, { headers: t.bearer() })).status).toBe(404);
    expect((await t.fetch(`/api/assets/${asset.id}`, { method: "DELETE", headers: t.bearer() })).status).toBe(404);
  });

  it("answers 404 for an id it does not have", async () => {
    const t = setup();
    for (const method of ["GET", "DELETE"]) expect((await t.fetch("/api/assets/q3Xv9LmT0bZk", { method, headers: t.bearer() })).status).toBe(404);
    expect((await t.fetch("/api/assets/q3Xv9LmT0bZk", { method: "PATCH", headers: t.bearer(), json: { title: "x" } })).status).toBe(404);
  });
});

describe("GetFile", () => {
  async function served() {
    const t = setup();
    const body = bytes(1000);
    const asset = await t.put("clip.mp4", body);
    const get = (headers: Record<string, string> = {}, method = "GET") => t.fetch(new URL(asset.fileUrl).pathname, { method, headers: { ...t.bearer(), ...headers } });
    return { t, body, asset, get };
  }

  it("answers 200 with the whole file, its type, Accept-Ranges: bytes and an ETag", async () => {
    const { body, asset, get } = await served();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe("1000");
    expect(res.headers.get("etag")).toBe(`"${asset.sha256}"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
  });

  it("answers 206 with Content-Range and just the bytes of a range", async () => {
    const { body, get } = await served();
    for (const [range, start, end] of [
      ["bytes=0-1", 0, 1],
      ["bytes=100-499", 100, 499],
      ["bytes=900-", 900, 999],
      ["bytes=-10", 990, 999],
      ["bytes=990-5000", 990, 999],
    ] as const) {
      const res = await get({ range });
      expect(res.status, range).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes ${start}-${end}/1000`);
      expect(res.headers.get("content-length")).toBe(String(end - start + 1));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(body.subarray(start, end + 1));
    }
  });

  it("answers 416 for a range past the end, and the whole file for one it cannot read", async () => {
    const { get } = await served();
    const past = await get({ range: "bytes=1000-" });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */1000");
    expect((await get({ range: "bytes=0-1,5-6" })).status).toBe(200);
  });

  it("answers HEAD with the headers and no body", async () => {
    const { get } = await served();
    const res = await get({ range: "bytes=0-9" }, "HEAD");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-length")).toBe("10");
    expect(await res.text()).toBe("");
  });

  it("answers as an attachment with ?download=1 and changes nothing else", async () => {
    const { t, asset, body } = await served();
    const path = new URL(asset.fileUrl).pathname;
    const at = (query: string, headers: Record<string, string> = {}, method = "GET") => t.fetch(path + query, { method, headers: { ...t.bearer(), ...headers } });
    const plain = await at("");
    const saved = await at("?download=1");
    expect(plain.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''clip.mp4");
    expect(saved.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''clip.mp4");
    expect(saved.status).toBe(200);
    expect(new Uint8Array(await saved.arrayBuffer())).toEqual(body);
    const same = (a: Response, b: Response) => {
      const rest = (r: Response) => [...r.headers].filter(([k]) => k !== "content-disposition");
      expect(rest(a)).toEqual(rest(b));
      expect(a.status).toBe(b.status);
    };
    same(plain, saved);
    expect(saved.headers.get("etag")).toBe(`"${asset.sha256}"`);
    expect(saved.headers.get("x-content-type-options")).toBe("nosniff");
    expect(saved.headers.get("content-security-policy")).toMatch(/^sandbox/);
    const ranged = await at("?download=1", { range: "bytes=100-199" });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(ranged.headers.get("content-disposition")).toMatch(/^attachment/);
    same(await at("", { range: "bytes=100-199" }), ranged);
    const head = await at("?download=1", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    same(await at("", {}, "HEAD"), head);
    expect(head.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("answers 404 for the right id under another name", async () => {
    const { t, asset } = await served();
    expect((await t.fetch(`/f/${asset.id}/other.mp4`, { headers: t.bearer() })).status).toBe(404);
  });
});

describe("upload URLs", () => {
  it("uploads once by the URL, with no token, as the details it was made with", async () => {
    const t = setup();
    const res = await t.fetch("/api/uploads", { method: "POST", headers: { ...t.bearer(), "x-actor": "implementer-x" }, json: { name: "big.mp4", repo: "o/r", pr: 4, tags: ["demo"] } });
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; link: string; uploadUrl: string; curl: string; expiresAt: string };
    expect(made.uploadUrl).toMatch(/^http:\/\/peek\.test\/api\/uploads\/[\w-]{32}$/);
    expect(made.curl).toBe(`curl -fsS -T <file> '${made.uploadUrl}'`);
    expect(made.link).toBe(`http://peek.test/a/${made.id}`);
    expect(new Date(made.expiresAt).getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect((await t.fetch(`/api/assets/${made.id}`, { headers: t.bearer() })).status).toBe(404);

    const path = new URL(made.uploadUrl).pathname;
    const first = await t.fetch(path, { method: "PUT", body: new TextEncoder().encode("video bytes") });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ id: made.id, name: "big.mp4", contentType: "video/mp4", repo: "o/r", pr: 4, tags: ["demo"], createdBy: "implementer-x", sha256: sha("video bytes") });
    const second = await t.fetch(path, { method: "PUT", body: "again" });
    expect(second.status).toBe(403);
    expect(t.peek.find(made.id).sha256).toBe(sha("video bytes"));
  });

  it("refuses a URL after its hour", async () => {
    let now = new Date("2026-11-15T00:00:00Z");
    const t = setup({ now: () => now });
    const made = (await (await t.fetch("/api/uploads", { method: "POST", headers: t.bearer(), json: { name: "a.png" } })).json()) as { uploadUrl: string };
    now = new Date("2026-11-15T01:00:01Z");
    expect((await t.fetch(new URL(made.uploadUrl).pathname, { method: "PUT", body: "x" })).status).toBe(403);
  });
});
