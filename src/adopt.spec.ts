import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adoptPaths } from "./adopt.ts";
import { DiskFiles } from "./files.ts";
import { importPeek } from "./importer.ts";
import { Store } from "./store.ts";
import { setup, temp } from "./testing.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/** The API, and a way to put in a path asset as a catalog written by an earlier peek held it. */
function legacy() {
  const t = setup();
  const dir = temp("peek-legacy-");
  const add = (id: string, name: string, data: Uint8Array | string | null, extra: Record<string, unknown> = {}) => {
    const path = join(dir, id, name);
    if (data !== null) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    }
    t.store.putAsset({ id, name, contentType: name.endsWith(".mp4") ? "video/mp4" : "image/png", size: null, sha256: null, path, title: "t", description: null, repo: "o/r", pr: 3, task: null, tags: ["x"], createdBy: "agent", createdAt: "2026-11-01T00:00:00.000Z", ...extra });
    return path;
  };
  return { ...t, add };
}

describe("a path upload", () => {
  const refused = (res: Response) => res.text().then((text) => ({ status: res.status, text }));

  it("is refused by the API, saying to send content or use the upload URL", async () => {
    const t = setup();
    const post = await refused(await t.fetch("/api/assets", { method: "POST", headers: t.bearer(), json: { path: "/cellar/peek/a.png" } }));
    expect(post.status).toBe(400);
    expect(post.text).toContain("content");
    expect(post.text).toContain("upload URL");
    const ticket = await refused(await t.fetch("/api/uploads", { method: "POST", headers: t.bearer(), json: { name: "a.png", path: "/x/a.png" } }));
    expect(ticket.status).toBe(400);
    expect(ticket.text).toContain("upload URL");
    const put = await refused(await t.fetch("/api/assets?name=a.png&path=/x/a.png", { method: "PUT", headers: t.bearer(), body: "x" }));
    expect(put.status).toBe(400);
    expect(t.store.assets({ maxResults: 10 }).assets).toEqual([]);
  });

  it("is refused by upload_asset", async () => {
    const t = setup();
    const res = await t.fetch("/mcp", {
      method: "POST",
      headers: { ...t.bearer(), accept: "application/json, text/event-stream" },
      json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "upload_asset", arguments: { name: "a.png", path: "/x/a.png" } } },
    });
    const result = ((await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("upload URL");
  });
});

describe("a path asset not yet adopted", () => {
  it("plays, with byte ranges", async () => {
    const t = legacy();
    t.add("abcdefghijkl", "r.mp4", bytes(1000));
    const asset = (await (await t.fetch("/api/assets/abcdefghijkl", { headers: t.bearer() })).json()) as { fileUrl: string; path: string };
    const url = new URL(asset.fileUrl).pathname;
    const whole = await t.fetch(url, { headers: t.bearer() });
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes(1000));
    const part = await t.fetch(url, { headers: { ...t.bearer(), range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes(1000).slice(100, 200));
    expect((await t.fetch(url, { headers: { ...t.bearer(), range: "bytes=5000-" } })).status).toBe(416);
  });

  it("answers 404 while its file is missing", async () => {
    const t = legacy();
    t.add("abcdefghijkl", "r.mp4", null);
    expect((await t.fetch("/f/abcdefghijkl/r.mp4", { headers: t.bearer() })).status).toBe(404);
  });
});

describe("peek adopt", () => {
  it("copies, hashes and clears the path, keeping the id and link, and a second run does nothing", async () => {
    const t = legacy();
    const path = t.add("abcdefghijkl", "a.mp4", bytes(700));
    const before = (await (await t.fetch("/api/assets/abcdefghijkl", { headers: t.bearer() })).json()) as { link: string };
    const first = await adoptPaths(t.store, t.peek.files);
    expect(first).toEqual({ adopted: 1, problems: [] });
    const got = t.store.asset("abcdefghijkl")!;
    expect(got).toMatchObject({ path: null, size: 700, sha256: createHash("sha256").update(bytes(700)).digest("hex"), title: "t", repo: "o/r" });
    expect(readFileSync(join(t.files, "abcdefghijkl", "a.mp4"))).toEqual(Buffer.from(bytes(700)));
    expect(existsSync(path)).toBe(true);
    const after = (await (await t.fetch("/api/assets/abcdefghijkl", { headers: t.bearer() })).json()) as { link: string; path: string | null };
    expect(after).toMatchObject({ link: before.link, path: null });
    // It plays from peek's own file now, even with the original gone.
    rmSync(path);
    expect(new Uint8Array(await (await t.fetch("/f/abcdefghijkl/a.mp4", { headers: t.bearer() })).arrayBuffer())).toEqual(bytes(700));
    expect(await adoptPaths(t.store, t.peek.files)).toEqual({ adopted: 0, problems: [] });
  });

  it("lists a missing file and leaves its asset as it is", async () => {
    const t = legacy();
    const gone = t.add("mnopqrstuvwx", "gone.png", null);
    t.add("abcdefghijkl", "a.png", "x");
    const result = await adoptPaths(t.store, t.peek.files);
    expect(result.adopted).toBe(1);
    expect(result.problems).toEqual([`mnopqrstuvwx: no file at ${gone}`]);
    expect(t.store.asset("mnopqrstuvwx")).toMatchObject({ path: gone, size: null, sha256: null });
    expect(existsSync(join(t.files, "mnopqrstuvwx"))).toBe(false);
  });

  it("leaves an asset whose bytes are not the ones its catalog names", async () => {
    const t = legacy();
    const path = t.add("abcdefghijkl", "a.png", "x", { sha256: "0".repeat(64) });
    const result = await adoptPaths(t.store, t.peek.files);
    expect(result.adopted).toBe(0);
    expect(result.problems[0]).toContain("not the bytes its catalog names");
    expect(t.store.asset("abcdefghijkl")!.path).toBe(path);
    expect(existsSync(join(t.files, "abcdefghijkl"))).toBe(false);
  });

  it("runs as `peek adopt`", () => {
    const dir = temp();
    const db = join(dir, "peek.db");
    const store = Store.open(db);
    const path = join(dir, "src.png");
    writeFileSync(path, "pixels");
    store.putAsset({ id: "abcdefghijkl", name: "a.png", contentType: "image/png", size: null, sha256: null, path, title: null, description: null, repo: null, pr: null, task: null, tags: [], createdBy: "agent", createdAt: "2026-11-01T00:00:00.000Z" });
    store.close();
    const env = { PATH: process.env.PATH ?? "", PEEK_DB: db, PEEK_FILES: join(dir, "files") };
    const run = () => spawnSync(process.execPath, [CLI, "adopt"], { env, encoding: "utf8" });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("adopted 1 assets");
    expect(readFileSync(join(dir, "files", "abcdefghijkl", "a.png"), "utf8")).toBe("pixels");
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("adopted 0 assets");
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

  it("with --ids takes only the listed assets, keeping their ids, and skips those already here", async () => {
    const o = await other();
    const dir = temp();
    const ids = join(dir, "ids.txt");
    writeFileSync(ids, "abcdefghijkl\n\nzzzzzzzzzzzz\n");
    const env = { PATH: process.env.PATH ?? "", PEEK_DB: join(dir, "peek.db"), PEEK_FILES: join(dir, "files") };
    const run = () => spawnSync(process.execPath, [CLI, "import", "--db", o.db, "--files", o.files, "--ids", ids], { env, encoding: "utf8" });
    const first = run();
    expect(first.stdout).toContain("imported 1 assets");
    expect(first.stderr).toContain("zzzzzzzzzzzz: not in");
    expect(first.status).toBe(1);
    expect(existsSync(join(dir, "files", "abcdefghijkl", "a.png"))).toBe(true);
    expect(existsSync(join(dir, "files", "mnopqrstuvwx"))).toBe(false);
    const store = Store.open(join(dir, "peek.db"));
    expect(store.asset("abcdefghijkl")).not.toBeNull();
    expect(store.asset("mnopqrstuvwx")).toBeNull();
    store.close();
    expect(run().stdout).toContain("skipped 1 already here");
  });

  it("importPeek with a set of ids imports only those", async () => {
    const o = await other();
    const t = setup();
    expect(await importPeek(t.store, t.peek.files, o.db, o.files, new Set(["mnopqrstuvwx"]))).toEqual({ imported: 1, skipped: 0, problems: [] });
    expect(t.store.asset("abcdefghijkl")).toBeNull();
    expect(t.store.asset("mnopqrstuvwx")).not.toBeNull();
  });
});
