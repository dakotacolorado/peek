import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset } from "./domain.ts";
import { secretHash, Store } from "./store.ts";
import { temp } from "./testing.ts";

let n = 0;
const asset = (fields: Partial<Asset> = {}): Asset => ({
  id: `asset-${String(++n).padStart(6, "0")}`,
  name: "a.png",
  contentType: "image/png",
  size: 1,
  sha256: "x",
  path: null,
  title: null,
  description: null,
  repo: null,
  pr: null,
  task: null,
  tags: [],
  createdBy: "agent",
  createdAt: new Date(Date.UTC(2026, 10, 15, 0, 0, n)).toISOString(),
  ...fields,
});

const ids = (assets: Asset[]) => assets.map((a) => a.id);

describe("Store.assets", () => {
  function seeded() {
    const store = Store.open(":memory:");
    const all = [
      asset({ name: "login.mp4", contentType: "video/mp4", repo: "o/web", pr: 1, task: "75d018b6", tags: ["before", "mobile"], title: "Login flow" }),
      asset({ name: "login-after.mp4", contentType: "video/mp4", repo: "o/web", pr: 1, tags: ["after", "mobile"], createdBy: "implementer-1" }),
      asset({ name: "tone.mp3", contentType: "audio/mpeg", repo: "o/web", pr: 2, description: "The 100% FINAL chime" }),
      asset({ name: "shot.png", repo: "o/api", task: "75d018b6", tags: ["mobile"] }),
    ];
    for (const a of all) store.putAsset(a);
    return { store, all };
  }

  it("lists newest first", () => {
    const { store, all } = seeded();
    expect(ids(store.assets({ maxResults: 50 }).assets)).toEqual(ids(all).reverse());
  });

  it("filters by repo, pr, task, every tag given, content type prefix, creator and text", () => {
    const { store, all } = seeded();
    const [login, after, tone, shot] = all as [Asset, Asset, Asset, Asset];
    const list = (filter: object) => ids(store.assets({ maxResults: 50, ...filter }).assets);
    expect(list({ repo: "o/web" })).toEqual(ids([tone, after, login]));
    expect(list({ repo: "o/web", pr: 1 })).toEqual(ids([after, login]));
    expect(list({ task: "75d018b6" })).toEqual(ids([shot, login]));
    expect(list({ tags: ["mobile"] })).toEqual(ids([shot, after, login]));
    expect(list({ tags: ["mobile", "before"] })).toEqual(ids([login]));
    expect(list({ contentType: "video/" })).toEqual(ids([after, login]));
    expect(list({ contentType: "VIDEO/" })).toEqual(ids([after, login]));
    expect(list({ contentType: "audio/mpeg" })).toEqual(ids([tone]));
    expect(list({ createdBy: "implementer-1" })).toEqual(ids([after]));
    expect(list({ q: "login" })).toEqual(ids([after, login]));
    expect(list({ q: "LOGIN FLOW" })).toEqual(ids([login]));
    expect(list({ q: "100%" })).toEqual(ids([tone]));
    expect(list({ q: "_" })).toEqual([]);
    expect(list({ repo: "o/web", contentType: "video/", tags: ["after"] })).toEqual(ids([after]));
  });

  it("pages with nextToken, through assets made in the same millisecond", () => {
    const store = Store.open(":memory:");
    const at = "2026-11-15T00:00:00.000Z";
    const all = Array.from({ length: 7 }, (_, i) => asset({ id: `same-at-${i}`.padEnd(12, "x"), createdAt: at }));
    for (const a of all) store.putAsset(a);
    const seen: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = store.assets({ maxResults: 3, nextToken });
      expect(page.assets.length).toBeLessThanOrEqual(3);
      seen.push(...ids(page.assets));
      nextToken = page.nextToken ?? undefined;
    } while (nextToken);
    expect(seen).toEqual(ids(all).sort().reverse());
  });

  it("says when the last page is reached, and refuses a token it did not give", () => {
    const { store } = seeded();
    expect(store.assets({ maxResults: 4 }).nextToken).toBeNull();
    expect(store.assets({ maxResults: 3 }).nextToken).not.toBeNull();
    expect(() => store.assets({ maxResults: 3, nextToken: "nonsense" })).toThrow(/nextToken/);
  });
});

describe("Store records", () => {
  it("updates only the fields given, and clears those given as null", () => {
    const store = Store.open(":memory:");
    const a = asset({ title: "t", repo: "o/r", pr: 3, tags: ["x"] });
    store.putAsset(a);
    expect(store.updateAsset(a.id, { title: "new", pr: null, tags: ["y", "z"] })).toMatchObject({ title: "new", repo: "o/r", pr: null, tags: ["y", "z"] });
    expect(store.updateAsset(a.id, {})).toMatchObject({ title: "new" });
    expect(store.updateAsset("missing", { title: "x" })).toBeNull();
  });

  it("keeps tokens, sessions and tickets as hashes only", () => {
    const store = Store.open(":memory:");
    const at = new Date();
    store.putToken("agent", "token-secret", at);
    store.putSession("session-secret", secretHash("token-secret"), "agent", at, new Date(at.getTime() + 1000));
    store.putTicket("ticket-secret", { id: "abc", name: "a.png", contentType: null, createdBy: "agent" }, at, new Date(at.getTime() + 1000));
    const dump = JSON.stringify([store.db.prepare("SELECT * FROM tokens").all(), store.db.prepare("SELECT * FROM sessions").all(), store.db.prepare("SELECT * FROM tickets").all()]);
    for (const secret of ["token-secret", "session-secret", "ticket-secret"]) expect(dump).not.toContain(secret);
  });

  it("spends a ticket once, and not after it expires", () => {
    const store = Store.open(":memory:");
    const at = new Date("2026-11-15T00:00:00Z");
    const hour = new Date("2026-11-15T01:00:00Z");
    store.putTicket("once", { id: "a", name: "a.png", contentType: null, createdBy: "agent" }, at, hour);
    store.putTicket("late", { id: "b", name: "b.png", contentType: null, createdBy: "agent" }, at, hour);
    expect(store.spendTicket("once", at)).toMatchObject({ id: "a", name: "a.png" });
    expect(store.spendTicket("once", at)).toBeNull();
    expect(store.spendTicket("late", hour)).toBeNull();
    expect(store.spendTicket("wrong", at)).toBeNull();
  });

  it("ends a session when it expires, or when its token is revoked", () => {
    const store = Store.open(":memory:");
    const at = new Date("2026-11-15T00:00:00Z");
    store.putToken("agent", "t", at);
    store.putSession("s", secretHash("t"), "agent", at, new Date("2026-11-16T00:00:00Z"));
    expect(store.session("s", at)).toEqual({ name: "agent", tokenHash: secretHash("t") });
    expect(store.session("s", new Date("2026-11-16T00:00:00Z"))).toBeNull();
    expect(store.revokeToken("agent")).toBe(true);
    expect(store.session("s", at)).toBeNull();
    expect(store.revokeToken("agent")).toBe(false);
  });

  it("migrates a new file, opens it again unchanged, and backs it up", async () => {
    const dir = temp();
    const file = join(dir, "peek.db");
    const first = Store.open(file);
    const a = asset();
    first.putAsset(a);
    await first.backup(join(dir, "backup.db"));
    first.close();
    const again = Store.open(file);
    expect(again.asset(a.id)).toEqual(a);
    again.close();
    const copy = Store.open(join(dir, "backup.db"));
    expect(copy.asset(a.id)).toEqual(a);
    copy.close();
  });
});
