#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PACKAGE_VERSION } from "./build.ts";
import { TOKEN_NAME } from "./domain.ts";
import { start } from "./server.ts";
import { Store } from "./store.ts";

export const TAGLINE = "Keeps an agent's images, videos and audio where it made them, and serves them back by a link that plays in the browser.";

const USAGE = `peek v${PACKAGE_VERSION}: ${TAGLINE}

Usage:
  peek [serve] [--dev] [options]   run the server; --dev takes the admin token "dev" when PEEK_ADMIN_TOKEN is unset
  peek backup <file>               copy the catalog, consistent while the server runs, to <file>;
                                   the files are the folder --files names, copied as any folder is

  peek token create <name>         make a token named <name>, printed once
  peek token list                  list tokens (never their secrets)
  peek token revoke <name>         revoke a token, and sign out every browser signed in with it

Options:
  --host <addr>       address to listen on (default 127.0.0.1, or PEEK_HOST)
  --port <n>          port (default 4810, or PEEK_PORT)
  --db <path>         the SQLite catalog (default ~/.local/share/peek/peek.db, or PEEK_DB)
  --files <dir>       the folder the files live in (default ~/.local/share/peek/files, or PEEK_FILES)
  --public-url <url>  the base every link is built on (default the address each request came to,
                      or PEEK_PUBLIC_URL)
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
    "public-url": { type: "string" },
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
const db = values.db ?? env.PEEK_DB ?? join(data, "peek.db");
const path = db === ":memory:" ? db : resolve(db);
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
const [command = "serve", ...rest] = positionals;

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
  process.exit(0);
}

if (command === "backup") {
  const [file] = rest;
  if (!file) fail("backup needs the file to write");
  await withStore(async (store) => {
    const pages = await store.backup(resolve(file!));
    say(`backed up ${path} to ${resolve(file!)} (${pages} pages)`);
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
const publicUrl = (values["public-url"] ?? env.PEEK_PUBLIC_URL ?? "").replace(/\/+$/, "") || null;
if (publicUrl && !/^https?:\/\/[^/]+(\/.*)?$/.test(publicUrl)) fail(`--public-url must be an http(s) URL, not ${publicUrl}`);

const dev = values.dev === true;
const adminToken = env.PEEK_ADMIN_TOKEN || (dev ? "dev" : null);
const running = start({ db: path, files, adminToken, publicUrl });
const shown = (at: number) => `http://${host.includes(":") ? `[${host}]` : host}:${at}`;
// Node ends a request after 5 minutes by default, which a large upload outlasts.
const server = serve({ fetch: running.api.fetch, hostname: host, port, serverOptions: { requestTimeout: 0 } }, (info) => {
  const lines = [
    `peek v${PACKAGE_VERSION}: ${TAGLINE}`,
    `  listening on ${shown(info.port)}`,
    `  links to     ${publicUrl ?? "the address each request came to"}`,
    `  catalog      ${path}`,
    `  files        ${files}`,
    ...(dev && !env.PEEK_ADMIN_TOKEN ? ['  Sign in with the admin token "dev".'] : []),
    ...(!adminToken && !running.store.tokens().length ? ["  No token: set PEEK_ADMIN_TOKEN, or make one with peek token create <name>."] : []),
  ];
  say(lines.join("\n"));
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
