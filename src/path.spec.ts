import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DiskFiles } from "./files.ts";
import { importPeek } from "./importer.ts";
import { Store } from "./store.ts";
import { setup, temp } from "./testing.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/** The API with a cellar root in a temporary folder, and a way to write a file under it. */
function cellar() {
  const root = temp("peek-cellar-");
  const t = setup({ cellarRoot: root });
  const write = (name: string, data: Uint8Array | string) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return path;
  };
  const add = (body: Record<string, unknown>, headers: Record<string, string> = t.bearer()) => t.fetch("/api/assets", { method: "POST", headers, json: body });
  return { ...t, root, write, add };
}

describe("an upload by path", () => {
  it("records a file under the root without copying it, and plays it", async () => {
    const t = cellar();
    const path = t.write("a/clip.mp4", bytes(1000));
    const res = await t.add({ path, repo: "o/r", pr: 3, title: "clip" });
    expect(res.status).toBe(201);
    const asset = (await res.json()) as { id: string; name: string; path: string; size: number; state: string; sha256: string | null; fileUrl: string; contentType: string };
    expect(asset).toMatchObject({ name: "clip.mp4", path, size: 1000, state: "ready", sha256: null, contentType: "video/mp4" });
    // Nothing was copied into peek's own files.
    expect(readdirSync(t.files).filter((f) => f !== ".uploads")).toEqual([]);
    const file = await t.fetch(new URL(asset.fileUrl).pathname, { headers: t.bearer() });
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes(1000));
    expect((await (await t.fetch(`/api/assets/${asset.id}`, { headers: t.bearer() })).json()) as object).toMatchObject({ state: "ready", size: 1000 });
  });

  it("answers byte ranges of a path asset", async () => {
    const t = cellar();
    const asset = (await (await t.add({ path: t.write("r.mp4", bytes(1000)) })).json()) as { fileUrl: string };
    const url = new URL(asset.fileUrl).pathname;
    const part = await t.fetch(url, { headers: { ...t.bearer(), range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes(1000).slice(100, 200));
    const tail = await t.fetch(url, { headers: { ...t.bearer(), range: "bytes=-10" } });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes(1000).slice(990));
    expect((await t.fetch(url, { headers: { ...t.bearer(), range: "bytes=5000-" } })).status).toBe(416);
  });

  it("refuses a path outside the root, a relative one, the root itself, and one that climbs out", async () => {
    const t = cellar();
    const outside = join(temp(), "x.png");
    writeFileSync(outside, "x");
    for (const path of [outside, "x.png", t.root, `${t.root}/../x.png`, join(t.files, "any", "a.png")]) {
      const res = await t.add({ path });
      expect(res.status, path).toBe(400);
    }
    expect(t.store.assets({ maxResults: 10 }).assets).toEqual([]);
  });

  it("does not serve a path asset whose file is a link out of the root", async () => {
    const t = cellar();
    const secret = join(temp(), "secret.png");
    writeFileSync(secret, "secret");
    const link = join(t.root, "link.png");
    symlinkSync(secret, link);
    const asset = (await (await t.add({ path: link })).json()) as { fileUrl: string; state: string };
    expect(asset.state).toBe("pending");
    expect((await t.fetch(new URL(asset.fileUrl).pathname, { headers: t.bearer() })).status).toBe(404);
  });

  it("refuses a path when peek has no cellar root, and a path already an asset's", async () => {
    const plain = setup();
    expect((await plain.fetch("/api/assets", { method: "POST", headers: plain.bearer(), json: { path: "/cellar/peek/a.png" } })).status).toBe(400);
    const t = cellar();
    const path = t.write("dup.png", "x");
    expect((await t.add({ path })).status).toBe(201);
    expect((await t.add({ path })).status).toBe(409);
  });

  it("needs a token", async () => {
    const t = cellar();
    expect((await t.add({ path: t.write("a.png", "x") }, {})).status).toBe(401);
  });

  it("is pending until its file appears, then ready and playing", async () => {
    const t = cellar();
    const path = join(t.root, "later", "v.mp4");
    const res = await t.add({ path });
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; state: string; size: number | null; fileUrl: string };
    expect(made).toMatchObject({ state: "pending", size: null });
    const url = new URL(made.fileUrl).pathname;
    expect((await t.fetch(url, { headers: t.bearer() })).status).toBe(404);
    const listed = (await (await t.fetch("/api/assets", { headers: t.bearer() })).json()) as { assets: { state: string }[] };
    expect(listed.assets[0]!.state).toBe("pending");
    t.write("later/v.mp4", bytes(300));
    expect((await (await t.fetch(`/api/assets/${made.id}`, { headers: t.bearer() })).json()) as object).toMatchObject({ state: "ready", size: 300 });
    const played = await t.fetch(url, { headers: t.bearer() });
    expect(played.status).toBe(200);
    expect(new Uint8Array(await played.arrayBuffer())).toEqual(bytes(300));
  });

  it("deletes the file it was given with the asset", async () => {
    const t = cellar();
    const path = t.write("gone.png", "x");
    const asset = (await (await t.add({ path })).json()) as { id: string };
    expect((await t.fetch(`/api/assets/${asset.id}`, { method: "DELETE", headers: t.bearer() })).status).toBe(200);
    expect(existsSync(path)).toBe(false);
  });

  it("is taken by upload_asset's path, and refused outside the root", async () => {
    const t = cellar();
    const call = async (args: Record<string, unknown>) => {
      const res = await t.fetch("/mcp", {
        method: "POST",
        headers: { ...t.bearer(), accept: "application/json, text/event-stream" },
        json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "upload_asset", arguments: args } },
      });
      return ((await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    };
    const ok = await call({ path: t.write("m.png", "x") });
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.content[0]!.text)).toMatchObject({ name: "m.png", state: "ready" });
    expect((await call({ path: "/etc/passwd" })).isError).toBe(true);
  });
});

describe("peek import", () => {
  /** A second instance's catalog and files, with one uploaded asset and one added by path. */
  async function other() {
    const dir = temp("peek-other-");
    const t = setup();
    const store = Store.open(join(dir, "peek.db"));
    const files = join(dir, "files");
    const source = new DiskFiles(files);
    const data = bytes(500);
    const written = await source.write("abcdefghijkl", "a.png", new Blob([data]).stream() as ReadableStream<Uint8Array>);
    const base = { name: "a.png", contentType: "image/png", title: "t", description: null, repo: "o/r", pr: 2, task: null, tags: ["x"], createdBy: "agent", createdAt: "2026-11-01T00:00:00.000Z" };
    store.putAsset({ ...base, id: "abcdefghijkl", size: 500, sha256: written.sha256, path: null });
    store.putAsset({ ...base, id: "mnopqrstuvwx", name: "p.mp4", contentType: "video/mp4", size: null, sha256: null, path: "/cellar/peek/p.mp4", createdAt: "2026-11-02T00:00:00.000Z" });
    store.close();
    return { db: join(dir, "peek.db"), files, data, sha: createHash("sha256").update(data).digest("hex"), t };
  }

  it("merges the catalog and files keeping ids, and a second run changes nothing", async () => {
    const o = await other();
    const t = setup();
    const first = await importPeek(t.store, t.peek.files, o.db, o.files);
    expect(first).toEqual({ imported: 2, skipped: 0, problems: [] });
    const got = t.store.asset("abcdefghijkl")!;
    expect(got).toMatchObject({ name: "a.png", sha256: o.sha, repo: "o/r", pr: 2, tags: ["x"], createdAt: "2026-11-01T00:00:00.000Z" });
    expect(t.store.asset("mnopqrstuvwx")).toMatchObject({ path: "/cellar/peek/p.mp4" });
    const file = await t.fetch("/f/abcdefghijkl/a.png", { headers: t.bearer() });
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(o.data);
    const again = await importPeek(t.store, t.peek.files, o.db, o.files);
    expect(again).toEqual({ imported: 0, skipped: 2, problems: [] });
    expect(t.store.assets({ maxResults: 10 }).assets).toHaveLength(2);
  });

  it("skips what is already here by id, and reports a file missing from the folder", async () => {
    const o = await other();
    const t = setup();
    await t.put("a.png", "x");
    const here = t.store.assets({ maxResults: 1 }).assets[0]!;
    const dir = temp();
    const result = await importPeek(t.store, t.peek.files, o.db, dir);
    expect(result.imported).toBe(1);
    expect(result.problems).toEqual([expect.stringContaining("abcdefghijkl: no file at")]);
    expect(t.store.asset(here.id)).not.toBeNull();
    expect(t.store.asset("abcdefghijkl")).toBeNull();
  });

  it("runs as `peek import`, and a second run reports nothing imported", async () => {
    const o = await other();
    const dir = temp();
    const env = { PATH: process.env.PATH ?? "", PEEK_DB: join(dir, "peek.db"), PEEK_FILES: join(dir, "files") };
    const run = () => spawnSync(process.execPath, [CLI, "import", "--db", o.db, "--files", o.files], { env, encoding: "utf8" });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("imported 2 assets");
    expect(existsSync(join(dir, "files", "abcdefghijkl", "a.png"))).toBe(true);
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("imported 0 assets");
    expect(second.stdout).toContain("skipped 2 already here");
    expect(spawnSync(process.execPath, [CLI, "import"], { env, encoding: "utf8" }).status).toBe(1);
  });
});
