#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { banner, SUMMARY, TAGLINE } from "./banner.ts";
import { PACKAGE_VERSION } from "./build.ts";
import { TOKEN_NAME } from "./domain.ts";
import { DiskFiles } from "./files.ts";
import { importPeek } from "./importer.ts";
import { start } from "./server.ts";
import { Store } from "./store.ts";

const USAGE = `peek v${PACKAGE_VERSION}: ${TAGLINE}
${SUMMARY}

Usage:
  peek [serve] [--dev] [options]   run the server; --dev takes the admin token "dev" when PEEK_ADMIN_TOKEN is unset
  peek backup <file>               copy the catalog, consistent while the server runs, to <file>;
                                   the files are the folder --files names, copied as any folder is

  peek import --db <db> --files <dir>
                                   merge another peek's catalog <db> and its files <dir> into this
                                   one (PEEK_DB, PEEK_FILES), keeping asset ids; assets already
                                   here are skipped, so running it again changes nothing

  peek token create <name>         make a token named <name>, printed once
  peek token list                  list tokens (never their secrets)
  peek token revoke <name>         revoke a token, and sign out every browser signed in with it

Options:
  --host <addr>       address to listen on (default 127.0.0.1, or PEEK_HOST)
  --port <n>          port (default 4810, or PEEK_PORT)
  --db <path>         the SQLite catalog (default ~/.local/share/peek/peek.db, or PEEK_DB)
  --files <dir>       the folder the files live in (default ~/.local/share/peek/files, or PEEK_FILES)
  --cellar-root <dir> the folder an upload by path must be under, on a drive every host shares
                      (default /cellar/peek, or PEEK_CELLAR_ROOT)
  --public-url <url>  the base every link is built on (default the address each request came to,
                      or PEEK_PUBLIC_URL)
  --task-url <url>    a task's page, {task} standing for its id, so the viewer links an asset's
                      task (default none, or PEEK_TASK_URL)
  -h, --help          this

Environment:
  PEEK_ADMIN_TOKEN    one more token, named "admin", beside those made with \`peek token\`

/health, the viewer page, /openapi.json, /mcp.json and the docs at /docs/api and
/docs/mcp need no token; everything else takes one. /mcp is the MCP server, for agents.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: "string" },
    port: { type: "string" },
    db: { type: "string" },
    files: { type: "string" },
    "cellar-root": { type: "string" },
    "public-url": { type: "string" },
    "task-url": { type: "string" },
    dev: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const fail = (message: string): never => {
  process.stderr.write(`peek: ${message}\n`);
  process.exit(1);
};
const say = (line: string) => process.stdout.write(`${line}\n`);

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const env = process.env;
const data = join(homedir(), ".local", "share", "peek");
const [command = "serve", ...rest] = positionals;
// Import's --db and --files name the peek it takes from; this one is PEEK_DB and PEEK_FILES.
const importing = command === "import";
const db = (importing ? null : values.db) ?? env.PEEK_DB ?? join(data, "peek.db");
const path = db === ":memory:" ? db : resolve(db);
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

/** Runs `fn` on the catalog, then closes it and exits. */
async function withStore(fn: (store: Store) => void | Promise<void>): Promise<never> {
  const store = Store.open(path);
  try {
    await fn(store);
  } catch (err) {
    store.close();
    fail((err as Error).message);
  }
  store.close();
  process.exit(process.exitCode ?? 0);
}

if (command === "backup") {
  const [file] = rest;
  if (!file) fail("backup needs the file to write");
  await withStore(async (store) => {
    const pages = await store.backup(resolve(file!));
    say(`backed up ${path} to ${resolve(file!)} (${pages} pages)`);
  });
}

if (importing) {
  const from = values.db;
  const fromFiles = values.files;
  if (!from || !fromFiles) fail("import needs --db, the other peek's catalog, and --files, its files' folder");
  const into = resolve(env.PEEK_FILES ?? join(data, "files"));
  if (resolve(from!) === path) fail(`--db ${from} is this peek's own catalog (PEEK_DB)`);
  if (resolve(fromFiles!) === into) fail(`--files ${fromFiles} is this peek's own files (PEEK_FILES)`);
  await withStore(async (store) => {
    mkdirSync(into, { recursive: true });
    const { imported, skipped, problems } = await importPeek(store, new DiskFiles(into), resolve(from!), resolve(fromFiles!));
    for (const problem of problems) process.stderr.write(`peek: not imported: ${problem}\n`);
    say(`imported ${imported} assets from ${resolve(from!)} into ${path}, skipped ${skipped} already here${problems.length ? `, ${problems.length} not imported` : ""}`);
    if (problems.length) process.exitCode = 1;
  });
}

if (command === "token") {
  const [action, name] = rest;
  await withStore((store) => {
    if (action === "create") {
      if (!name || !TOKEN_NAME.test(name)) fail(`token create needs a name: lowercase letters, digits, ".", "_" or "-", as ${TOKEN_NAME}`);
      if (name === "admin") fail('"admin" is PEEK_ADMIN_TOKEN\'s name; choose another');
      const token = randomBytes(32).toString("base64url");
      store.putToken(name!, token, new Date());
      process.stderr.write(`peek: made token "${name}"; it is shown once:\n`);
      say(token);
    } else if (action === "list") {
      const tokens = store.tokens();
      if (!tokens.length) say("no tokens: make one with peek token create <name>");
      for (const t of tokens) say(`${t.name}\tmade ${t.createdAt}\t${t.lastUsedAt ? `last used ${t.lastUsedAt}` : "never used"}`);
    } else if (action === "revoke") {
      if (!name) fail("token revoke needs the token's name");
      if (!store.revokeToken(name!)) fail(`no token named "${name}"`);
      say(`revoked "${name}"`);
    } else fail("token takes create, list or revoke");
  });
}

if (command !== "serve") fail(`unknown command "${command}"\n\n${USAGE}`);

const host = values.host ?? env.PEEK_HOST ?? "127.0.0.1";
const portSetting = values.port ?? env.PEEK_PORT;
const port = Number(portSetting ?? 4810);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be a port number, not ${portSetting}`);
const files = resolve(values.files ?? env.PEEK_FILES ?? join(data, "files"));
const cellarRoot = resolve(values["cellar-root"] ?? env.PEEK_CELLAR_ROOT ?? "/cellar/peek");
const publicUrl = (values["public-url"] ?? env.PEEK_PUBLIC_URL ?? "").replace(/\/+$/, "") || null;
if (publicUrl && !/^https?:\/\/[^/]+(\/.*)?$/.test(publicUrl)) fail(`--public-url must be an http(s) URL, not ${publicUrl}`);

const taskUrl = values["task-url"] ?? env.PEEK_TASK_URL ?? null;
if (taskUrl && !/^https?:\/\/[^/]+\/.*\{task\}/.test(taskUrl)) fail(`--task-url must be an http(s) URL holding {task}, not ${taskUrl}`);

const dev = values.dev === true;
const adminToken = env.PEEK_ADMIN_TOKEN || (dev ? "dev" : null);
const running = start({ db: path, files, cellarRoot, adminToken, publicUrl, taskUrl });
const shown = (at: number) => `http://${host.includes(":") ? `[${host}]` : host}:${at}`;
// Node ends a request after 5 minutes by default, which a large upload outlasts.
const server = serve({ fetch: running.api.fetch, hostname: host, port, serverOptions: { requestTimeout: 0 } }, (info) => {
  const notes = [
    ...(dev && !env.PEEK_ADMIN_TOKEN ? ['Sign in with the admin token "dev".'] : []),
    ...(!adminToken && !running.store.tokens().length ? ["No token: set PEEK_ADMIN_TOKEN, or make one with peek token create <name>."] : []),
  ];
  const color = Boolean(process.stdout.isTTY) && !env.NO_COLOR;
  process.stdout.write(banner({ version: PACKAGE_VERSION, url: shown(info.port), publicUrl: publicUrl ?? shown(info.port), db: path, files, notes, color }));
});

server.on("error", (err) => {
  running.close();
  fail(`cannot serve on ${host}:${port}: ${err.message}`);
});

const stop = () => {
  server.close();
  running.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
