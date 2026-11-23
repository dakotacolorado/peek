import { OpenAPIHono } from "@hono/zod-openapi";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { LETTERS_ONLY, MARK_ICON, MARK_PIXELS, SUMMARY, TAGLINE } from "./banner.ts";
import { creatorOf, INLINE_MAX, newSecret, rangeOf, RequestError, SESSION_SECONDS, type Asset } from "./domain.ts";
import { DOCS_URL, mcpServer, type Call } from "./mcp.ts";
import * as routes from "./schema.ts";
import { ERROR_CODES, type ErrorStatus } from "./schema.ts";
import type { Peek } from "./service.ts";
import { secretHash } from "./store.ts";

export const SPEC_PATH = "/openapi.json";

/** The API's version, dated as AWS dates theirs: changed only when the contract is. */
export const API_VERSION = "2026-11-15";

/** The browser's session cookie. */
export const SESSION_COOKIE = "peek_session";

/** The API's overview, at the top of its reference. Markdown. */
export const OVERVIEW = `${SUMMARY} **Agents** upload a file they made, a screenshot, a screen recording, a sound or a text or markdown report, saying what it is for (a repository and pull request, a waypoint task, tags), and give **the person** its \`link\`, which shows or plays it in their browser, on a phone too (text and markdown up to 1 MB show as text, markdown formatted).

- **Upload** with \`PutAsset\`: the file's bytes are the request body, streamed to disk, so a several-GB video works. An agent with only the MCP server asks for an upload URL instead (\`CreateUploadUrl\`), and runs the \`curl\` it answers: the file never passes through the model, and the command needs no token.
- **Find** with \`ListAssets\`, by repository, pull request, task, tags, media type, uploader or text, newest first.
- **Serve:** an asset's \`fileUrl\` (\`GetFile\`) answers byte ranges, so a browser seeks a video; its \`link\` is the page that shows it.
- **Change** what an asset is of with \`UpdateAsset\`, and remove it, file and all, with \`DeleteAsset\`.

**Auth:** \`Authorization: Bearer <token>\` on everything but \`GetHealth\`, \`PutUpload\` (whose URL is its own single-use ticket), the docs and the page. Each token has a name, made with \`peek token create <name>\`; \`PEEK_ADMIN_TOKEN\` is one more, named \`admin\`. Every token may do everything. A browser signs in once with \`CreateSession\`, which sets a cookie that every call then takes, so \`<img>\`, \`<video>\` and \`<audio>\` load; a write signed in by the cookie alone must also send \`x-peek: 1\`, or is refused 403.

**Uploader:** an asset's \`createdBy\` is the uploader's \`x-actor\` header, when it gives one, else its token's name.

**Errors:** \`{code, message}\`, where \`code\` is an AWS-style exception name such as \`ValidationException\` or \`ResourceNotFoundException\`.`;

export interface About {
  /** `package.json`'s version. */
  version: string;
  /** The commit it was built from, `-dirty` when built with uncommitted changes. */
  commit: string;
}

export interface ApiOptions {
  /** A token named `admin`, beside those in the database. */
  adminToken: string | null;
  /** The base every link is built on; else the address each request came to. */
  publicUrl: string | null;
  /** A task's page, `{task}` standing for its id; null links no task. */
  taskUrl?: string | null;
}

/** Who a request is from, and how it showed it. */
export interface Caller {
  name: string;
  /** A bearer token in the request, or a browser's session cookie alone. */
  by: "token" | "session";
}

type Env = { Variables: { caller: Caller } };

const digest = (secret: string) => createHash("sha256").update(secret).digest();

/** Headers a file is served with: whatever it holds, it runs nothing on peek's origin. */
const FILE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
  "cache-control": "private, max-age=31536000, immutable",
};

export class PeekApi {
  readonly hono: OpenAPIHono<Env>;

  private readonly peek: Peek;
  private readonly about: About;
  private readonly options: ApiOptions;

  constructor(peek: Peek, about: About, options: ApiOptions) {
    this.peek = peek;
    this.about = about;
    this.options = options;
    this.hono = new OpenAPIHono<Env>({
      defaultHook: (result, c) => (result.success ? undefined : fail(c, 400, issues(result.error))),
    });
    this.auth();
    this.routes();
    this.mcp();
    this.pages();
    this.spec();
  }

  get fetch() {
    return this.hono.fetch;
  }

  /** The name a bearer token is: `admin` for the environment's, else a stored token's. */
  private tokenCaller(secret: string): { name: string; hash: string } | null {
    const admin = this.options.adminToken;
    if (admin && timingSafeEqual(digest(secret), digest(admin))) return { name: "admin", hash: secretHash(secret) };
    const token = this.peek.store.tokenFor(secret, new Date());
    return token && { name: token.name, hash: secretHash(secret) };
  }

  private bearer(c: Context): { name: string; hash: string } | null {
    const secret = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    return secret ? this.tokenCaller(secret) : null;
  }

  /** A session counts while the token that made it still does. */
  private sessionCaller(c: Context): Caller | null {
    const secret = getCookie(c, SESSION_COOKIE);
    const session = secret ? this.peek.store.session(secret, new Date()) : null;
    if (!session) return null;
    const admin = this.options.adminToken;
    const live = (admin !== null && session.tokenHash === secretHash(admin)) || this.peek.store.hasToken(session.tokenHash);
    return live ? { name: session.name, by: "session" } : null;
  }

  private auth(): void {
    const signedIn = (allowSession: boolean) => async (c: Context<Env>, next: Next) => {
      const token = this.bearer(c);
      const caller: Caller | null = token ? { name: token.name, by: "token" } : allowSession ? this.sessionCaller(c) : null;
      if (!caller) return fail(c, 401, "No bearer token or session, or it is wrong, revoked or expired.");
      // A cookie goes with any request a page on another site makes; a header such a page cannot add shows it is ours.
      if (caller.by === "session" && !["GET", "HEAD"].includes(c.req.method) && c.req.header("x-peek") !== "1")
        return fail(c, 403, "A write signed in by the session cookie alone must send the header x-peek: 1.");
      c.set("caller", caller);
      await next();
    };
    const anyway = signedIn(true);
    this.hono.use("/api/*", async (c, next) => {
      // An upload URL is its own credential, and signing in takes the bearer token itself.
      if (c.req.method === "PUT" && /^\/api\/uploads\/[^/]+$/.test(c.req.path)) return next();
      if (c.req.method === "POST" && c.req.path === "/api/session") return next();
      return anyway(c, next);
    });
    this.hono.use("/f/*", anyway);
    this.hono.use("/mcp", signedIn(false));
  }

  /** Where links point: the public URL, else the address the request came to. */
  private base(c: Context): string {
    if (this.options.publicUrl) return this.options.publicUrl;
    return originOf(c) ?? new URL(c.req.url).origin;
  }

  private shown(c: Context, asset: Asset) {
    const base = this.base(c);
    const taskUrl = this.options.taskUrl;
    const taskLink = taskUrl && asset.task ? taskUrl.replaceAll("{task}", encodeURIComponent(asset.task)) : null;
    return { ...asset, link: `${base}/a/${asset.id}`, taskLink, fileUrl: `${base}/f/${asset.id}/${encodeURIComponent(asset.name)}` };
  }

  private routes(): void {
    const app = this.hono;
    const creator = (c: Context<Env>) => creatorOf(c.req.header("x-actor"), c.get("caller").name);
    const tags = (list: string | undefined) => (list === undefined ? undefined : list.split(",").map((tag) => tag.trim()).filter(Boolean));

    app.openapi(routes.healthRoute, (c) => c.json({ ok: true as const, ...this.about }, 200));

    app.openapi(routes.putRoute, async (c) => {
      const { tags: list, ...query } = c.req.valid("query");
      const upload = { ...query, tags: parsedTags(tags(list)), contentType: c.req.header("content-type") };
      const asset = await this.peek.put(upload, c.req.raw.body, creator(c));
      return c.json(this.shown(c, asset), 201);
    });

    // Not an operation: it only tells a caller that still posts a path what to send instead.
    app.post("/api/assets", (c) => fail(c, 400, routes.NO_PATH));


    app.openapi(routes.listRoute, async (c) => {
      const { tags: list, ...query } = c.req.valid("query");
      const page = this.peek.store.assets({ ...query, tags: parsedTags(tags(list)) });
      const assets = page.assets.map((asset) => this.shown(c, asset));
      return c.json({ assets, nextToken: page.nextToken }, 200);
    });

    app.openapi(routes.getRoute, async (c) => c.json(this.shown(c, this.peek.find(c.req.valid("param").id)), 200));

    app.openapi(routes.updateRoute, async (c) => c.json(this.shown(c, this.peek.update(c.req.valid("param").id, c.req.valid("json"))), 200));

    app.openapi(routes.deleteRoute, async (c) => {
      const { id } = c.req.valid("param");
      const shown = this.peek.find(id);
      await this.peek.delete(id);
      return c.json(this.shown(c, shown), 200);
    });

    app.openapi(routes.createUploadRoute, (c) => {
      const { secret, upload, expiresAt } = this.peek.ticket(c.req.valid("json"), creator(c));
      const base = this.base(c);
      const uploadUrl = `${base}/api/uploads/${secret}`;
      return c.json({ id: upload.id, link: `${base}/a/${upload.id}`, uploadUrl, curl: `curl -fsS -T <file> '${uploadUrl}'`, expiresAt: expiresAt.toISOString() }, 201);
    });

    app.openapi(routes.putUploadRoute, async (c) => {
      const asset = await this.peek.putByTicket(c.req.valid("param").ticket, c.req.raw.body, c.req.header("content-type") ?? null);
      return c.json(this.shown(c, asset), 201);
    });

    app.openapi(routes.fileRoute, (async (c: Context<Env>) => {
      const { id, name } = (c.req as unknown as { valid: (t: "param") => { id: string; name: string } }).valid("param");
      const download = Boolean(c.req.query("download"));
      const asset = this.peek.store.asset(id);
      const size = asset && asset.name === name ? await this.peek.located(asset) : null;
      if (!asset || size === null) return fail(c, 404, "No asset has that id and name.");
      const range = rangeOf(c.req.header("range"), size);
      const headers: Record<string, string> = {
        ...FILE_HEADERS,
        "content-type": asset.contentType,
        "accept-ranges": "bytes",
        // A path asset not yet adopted has no hash.
        ...(asset.sha256 ? { etag: `"${asset.sha256}"` } : { "cache-control": "private, no-cache" }),
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      };
      if (range === "unsatisfiable") return c.json({ code: ERROR_CODES[416], message: `The range starts past the end of the file, ${size} bytes.` }, 416, { "content-range": `bytes */${size}` });
      const status = range ? 206 : 200;
      const span = range ?? { start: 0, end: size - 1 };
      headers["content-length"] = String(span.end - span.start + 1);
      if (range) headers["content-range"] = `bytes ${span.start}-${span.end}/${size}`;
      // Hono answers HEAD from the GET route and drops the body; an opened file would be left to the collector.
      if (c.req.method === "HEAD") return c.body(null, status, headers);
      return c.body(this.peek.read(asset, span), status, headers);
    }) as never);

    app.openapi(routes.createSessionRoute, (c) => {
      const token = this.bearer(c);
      if (!token) return fail(c, 401, "The bearer token is missing, wrong or revoked.") as never;
      const secret = newSecret();
      const at = new Date();
      const expiresAt = new Date(at.getTime() + SESSION_SECONDS * 1000);
      this.peek.store.putSession(secret, token.hash, token.name, at, expiresAt);
      c.header("set-cookie", `${SESSION_COOKIE}=${secret}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
      return c.json({ name: token.name, expiresAt: expiresAt.toISOString() }, 200);
    });

    app.openapi(routes.deleteSessionRoute, (c) => {
      const secret = getCookie(c, SESSION_COOKIE);
      if (secret) this.peek.store.deleteSession(secret);
      c.header("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      return c.json({ ok: true as const }, 200);
    });

    // Hono throws HTTPException for a malformed body before any handler runs;
    // collapsing this to 500 would report a bad request as our failure.
    app.onError((err, c) => {
      if (err instanceof RequestError) return fail(c, err.status, err.message);
      if (err instanceof HTTPException) return fail(c, err.status in ERROR_CODES ? (err.status as ErrorStatus) : 400, err.message || "The request is malformed.");
      console.error("Unhandled error:", err);
      return fail(c, 500, "Something went wrong on our side.");
    });
  }

  /**
   * The MCP server, at `/mcp`, stateless: each request gets its own, whose
   * tools make their API requests in-process with the request's own
   * `authorization` and `x-actor`, at the address it came to.
   */
  private mcp(): void {
    this.hono.all("/mcp", async (c) => {
      const forwarded = Object.fromEntries(
        ["authorization", "x-actor", "x-forwarded-proto", "x-forwarded-host"].flatMap((name) => {
          const value = c.req.header(name);
          return value === undefined ? [] : [[name, value]];
        }),
      );
      const origin = new URL(c.req.url).origin;
      const call: Call = (method, path, init = {}) => {
        const body = init.bytes ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
        const type = init.bytes ? init.contentType : init.body !== undefined ? "application/json" : undefined;
        return Promise.resolve(this.hono.fetch(new Request(`${origin}${path}`, { method, headers: { ...forwarded, ...(type && { "content-type": type }) }, body })));
      };
      // The SDK's default 4 MB would refuse inline content upload_asset is documented to take.
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: INLINE_MAX + 1_000_000 });
      await mcpServer(this.about.version, call).connect(transport);
      return transport.handleRequest(c.req.raw);
    });
  }

  /** The viewer's shell, and the API's and the MCP server's docs, read at their first request: none needs a token, and none holds data. */
  private pages(): void {
    const files = new Map<string, string>();
    const file = (path: string) => {
      if (!files.has(path)) files.set(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
      return files.get(path)!;
    };
    const SHELL_CSP = "default-src 'self'; img-src 'self'; media-src 'self'; object-src 'none'; frame-ancestors 'none'";
    const page = (path: string, type: string, extra: Record<string, string> = {}) => (c: Context) => c.body(file(path), 200, { "content-type": `${type}; charset=utf-8`, ...extra });
    const shell = page("ui/index.html", "text/html", { "content-security-policy": SHELL_CSP });
    this.hono.get("/", shell);
    this.hono.get("/a/:id", shell);
    this.hono.get("/ui/app.js", page("ui/app.js", "text/javascript"));
    this.hono.get("/ui/markdown.js", page("ui/markdown.js", "text/javascript"));
    this.hono.get("/ui/style.css", page("ui/style.css", "text/css"));
    // The page's words and mark are banner.ts's own, so the terminal, the page and the tab cannot differ.
    const words = Object.entries({ LETTERS: LETTERS_ONLY, MARK_PIXELS, TAGLINE, SUMMARY }).map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};\n`).join("");
    this.hono.get("/ui/banner.js", (c) => c.body(words, 200, { "content-type": "text/javascript; charset=utf-8" }));
    this.hono.get("/ui/mark.svg", (c) => c.body(MARK_ICON, 200, { "content-type": "image/svg+xml; charset=utf-8" }));
    this.hono.get("/docs/api", page("docs/index.html", "text/html"));
    this.hono.get("/mcp.json", page("mcp.json", "application/json"));
    // The docs' example address is a placeholder; served, they give the address they were reached at.
    this.hono.get("/docs/mcp", (c) => c.body(file("docs/mcp.html").replaceAll(DOCS_URL, originOf(c) ?? DOCS_URL), 200, { "content-type": "text/html; charset=utf-8" }));
  }

  private spec(): void {
    this.hono.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
      type: "http",
      scheme: "bearer",
      description: "A named token from `peek token create`, or `PEEK_ADMIN_TOKEN`.",
    });
    this.hono.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
      type: "apiKey",
      in: "cookie",
      name: SESSION_COOKIE,
      description: "A browser's session, from `CreateSession`. A write signed in by it alone must also send `x-peek: 1`.",
    });
    this.hono.doc(SPEC_PATH, {
      openapi: "3.1.0",
      info: { version: API_VERSION, title: "peek", description: OVERVIEW },
      tags: [
        { name: "Assets", description: "Upload, find, change and delete what peek keeps." },
        { name: "Files", description: "An asset's bytes, by its `fileUrl`." },
        { name: "Sessions", description: "Signing a browser in, so media elements load." },
        { name: "Platform", description: "Health." },
      ],
    });
  }
}

/** The origin a request was sent to, through a proxy too; only what an address can be, since it is reflected into answers. */
function originOf(c: Context): string | null {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return /^https?$/.test(proto) && /^[\w.-]+(:\d+)?$|^\[[\da-fA-F:.]+\](:\d+)?$/.test(host) ? `${proto}://${host}` : null;
}

/** Tags from a query, each held to a tag's rules. */
function parsedTags(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  const result = routes.UploadSchema.shape.tags.safeParse(tags);
  if (!result.success) throw new RequestError(`tags: ${issues(result.error)}`);
  return result.data;
}

/** An error answer as an AWS API gives one: `{code, message}`, the code named for the status. */
function fail(c: Context, status: ErrorStatus, message: string) {
  return c.json({ code: ERROR_CODES[status], message }, status);
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
}
