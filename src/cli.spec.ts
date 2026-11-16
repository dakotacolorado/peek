import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./store.ts";
import { temp } from "./testing.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
/** The test's environment without any service's address or token, nor peek's own settings. */
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_(URL|TOKEN)$/.test(k) && !k.startsWith("PEEK_")));

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

/** Starts the server on a port the OS picks; answers its address once it says it listens. */
function serve(args: string[], env: Record<string, string> = {}): Promise<{ url: string; out: () => string }> {
  const child = spawn(process.execPath, [CLI, ...args, "--port", "0"], { env: { ...clean(), ...env } });
  children.push(child);
  let out = "";
  return new Promise((ready, fail) => {
    child.stdout.on("data", (d) => {
      out += d;
      const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1];
      if (url) ready({ url, out: () => out });
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => fail(new Error(`exited ${code}: ${out}`)));
  });
}

/** Runs one command to its end. */
const run = (args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { env: { ...clean(), ...env }, encoding: "utf8" });
  return { status: result.status, out: result.stdout, err: result.stderr };
};

describe("peek serve", () => {
  it("serves the catalog and files it is given, taking PEEK_ADMIN_TOKEN", async () => {
    const dir = temp();
    const { url, out } = await serve(["serve"], { PEEK_DB: join(dir, "db", "peek.db"), PEEK_FILES: join(dir, "files"), PEEK_ADMIN_TOKEN: "scratch", PEEK_PUBLIC_URL: "https://peek.example.com/" });
    expect(out()).toContain("See what your agents made, wherever you are.");
    expect(out()).toContain("  ▸ Page      https://peek.example.com/\n");
    // Piped, as here, it paints nothing.
    expect(out()).not.toContain("\x1b");
    expect(existsSync(join(dir, "db", "peek.db"))).toBe(true);
    expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ ok: true, version: "0.1.0" });
    expect((await fetch(`${url}/api/assets`)).status).toBe(401);
    const put = await fetch(`${url}/api/assets?name=a.png`, { method: "PUT", headers: { authorization: "Bearer scratch" }, body: new Uint8Array([1, 2, 3]) });
    expect(put.status).toBe(201);
    const asset = (await put.json()) as { id: string; link: string };
    expect(asset.link).toBe(`https://peek.example.com/a/${asset.id}`);
    expect(existsSync(join(dir, "files", asset.id, "a.png"))).toBe(true);
  });

  it("takes the admin token dev under --dev, and says to sign in with it", async () => {
    const dir = temp();
    const { url, out } = await serve(["serve", "--dev", "--db", join(dir, "peek.db"), "--files", join(dir, "files")]);
    expect(out()).toContain('Sign in with the admin token "dev".');
    expect((await fetch(`${url}/api/assets`, { headers: { authorization: "Bearer dev" } })).status).toBe(200);
  });

  it("says when it has no token at all", async () => {
    const dir = temp();
    const { out } = await serve(["--db", join(dir, "peek.db"), "--files", join(dir, "files")]);
    expect(out()).toContain("No token: set PEEK_ADMIN_TOKEN, or make one with peek token create <name>.");
  });

  it("refuses a port that is not one", () => {
    const dir = temp();
    const result = run(["serve", "--db", join(dir, "peek.db"), "--port", "nope"]);
    expect(result.status).toBe(1);
    expect(result.err).toContain("--port must be a port number");
  });
});

describe("peek token", () => {
  it("creates a token, printed once, that the server takes; lists it; revokes it", async () => {
    const dir = temp();
    const db = join(dir, "peek.db");
    const made = run(["token", "create", "agents", "--db", db]);
    expect(made.status).toBe(0);
    const secret = made.out.trim();
    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(run(["token", "list", "--db", db]).out).toMatch(/^agents\tmade .*\tnever used\n$/);
    const { url } = await serve(["--db", db, "--files", join(dir, "files")]);
    expect((await fetch(`${url}/api/assets`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    expect(run(["token", "revoke", "agents", "--db", db]).status).toBe(0);
    expect((await fetch(`${url}/api/assets`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(401);
    expect(run(["token", "revoke", "agents", "--db", db]).status).toBe(1);
  });

  it("refuses a bad name, and admin, which is PEEK_ADMIN_TOKEN's", () => {
    const db = join(temp(), "peek.db");
    expect(run(["token", "create", "Bad Name", "--db", db]).status).toBe(1);
    expect(run(["token", "create", "admin", "--db", db]).status).toBe(1);
  });
});

describe("peek backup", () => {
  it("copies the catalog to a file", () => {
    const dir = temp();
    const db = join(dir, "peek.db");
    run(["token", "create", "agents", "--db", db]);
    const result = run(["backup", join(dir, "copy.db"), "--db", db]);
    expect(result.status).toBe(0);
    const copy = Store.open(join(dir, "copy.db"));
    expect(copy.tokens().map((t) => t.name)).toEqual(["agents"]);
    copy.close();
  });
});
