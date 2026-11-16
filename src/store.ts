import { createHash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { RequestError, type Asset, type AssetFilter, type AssetMeta } from "./domain.ts";

/**
 * Each entry brings a database from the shape before it to the one after;
 * `PRAGMA user_version` counts those applied. Append, never edit: a database
 * already past an entry never runs it again.
 */
export const MIGRATIONS: string[] = [
  `
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  title TEXT,
  description TEXT,
  repo TEXT,
  pr INTEGER,
  task TEXT,
  tags TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX assets_newest ON assets (created_at DESC, id DESC);
CREATE INDEX assets_by_repo ON assets (repo, pr, created_at DESC);
CREATE INDEX assets_by_task ON assets (task, created_at DESC);
CREATE TABLE tokens (name TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE tickets (
  hash TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE,
  upload TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`,
];

export function migrate(db: DatabaseSync): void {
  const at = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let version = at; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export interface TokenInfo {
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What an upload ticket was made for: the asset it will be, before its bytes. */
export interface TicketUpload extends AssetMeta {
  id: string;
  name: string;
  contentType: string | null;
  createdBy: string;
}

export const secretHash = (secret: string): string => createHash("sha256").update(secret).digest("hex");

type Row = Record<string, unknown>;

const assetOf = (row: Row): Asset => ({
  id: row.id as string,
  name: row.name as string,
  contentType: row.content_type as string,
  size: row.size as number,
  sha256: row.sha256 as string,
  title: (row.title as string | null) ?? null,
  description: (row.description as string | null) ?? null,
  repo: (row.repo as string | null) ?? null,
  pr: (row.pr as number | null) ?? null,
  task: (row.task as string | null) ?? null,
  tags: JSON.parse(row.tags as string) as string[],
  createdBy: row.created_by as string,
  createdAt: row.created_at as string,
});

/** A page's place in the list, newest first: the last asset given. */
const encodeToken = (asset: Asset) => Buffer.from(JSON.stringify([asset.createdAt, asset.id])).toString("base64url");
function decodeToken(token: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string")) return value as [string, string];
  } catch {}
  throw new RequestError("nextToken: not one this service gave.");
}

const like = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The catalog of assets, the tokens, browser sessions and upload tickets, in
 * one SQLite database. Every write is one synchronous statement, so one
 * process never interleaves two.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    migrate(db);
  }

  static open(path: string): Store {
    return new Store(new DatabaseSync(path));
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** Copies the database to `file`, consistent while it is written to; answers the pages copied. */
  async backup(file: string): Promise<number> {
    return backup(this.db, file);
  }

  putAsset(asset: Asset): void {
    this.db
      .prepare(
        "INSERT INTO assets (id, name, content_type, size, sha256, title, description, repo, pr, task, tags, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        asset.id,
        asset.name,
        asset.contentType,
        asset.size,
        asset.sha256,
        asset.title,
        asset.description,
        asset.repo,
        asset.pr,
        asset.task,
        JSON.stringify(asset.tags),
        asset.createdBy,
        asset.createdAt,
      );
  }

  asset(id: string): Asset | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Row | undefined;
    return row ? assetOf(row) : null;
  }

  /** Sets the fields given; answers the asset as it now is, or null when there is none. */
  updateAsset(id: string, patch: AssetMeta): Asset | null {
    const columns = { title: patch.title, description: patch.description, repo: patch.repo, pr: patch.pr, task: patch.task, tags: patch.tags && JSON.stringify(patch.tags) };
    const set = Object.entries(columns).filter(([, value]) => value !== undefined);
    if (set.length) this.db.prepare(`UPDATE assets SET ${set.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`).run(...set.map(([, value]) => value ?? null), id);
    return this.asset(id);
  }

  deleteAsset(id: string): boolean {
    return this.db.prepare("DELETE FROM assets WHERE id = ?").run(id).changes > 0;
  }

  /** Assets matching every filter given, newest first, a page at a time. */
  assets(filter: AssetFilter): { assets: Asset[]; nextToken: string | null } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const add = (clause: string, ...values: (string | number)[]) => {
      where.push(clause);
      args.push(...values);
    };
    if (filter.repo !== undefined) add("repo = ?", filter.repo);
    if (filter.pr !== undefined) add("pr = ?", filter.pr);
    if (filter.task !== undefined) add("task = ?", filter.task);
    for (const tag of filter.tags ?? []) add("EXISTS (SELECT 1 FROM json_each(assets.tags) WHERE value = ?)", tag);
    if (filter.contentType !== undefined) add("content_type LIKE ? ESCAPE '\\'", `${like(filter.contentType.toLowerCase())}%`);
    if (filter.createdBy !== undefined) add("created_by = ?", filter.createdBy);
    if (filter.q !== undefined) {
      const q = `%${like(filter.q)}%`;
      add("(name LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')", q, q, q);
    }
    if (filter.nextToken !== undefined) {
      const [createdAt, id] = decodeToken(filter.nextToken);
      add("(created_at < ? OR (created_at = ? AND id < ?))", createdAt, createdAt, id);
    }
    const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
    const rows = (this.db.prepare(sql).all(...args, filter.maxResults + 1) as Row[]).map(assetOf);
    const assets = rows.slice(0, filter.maxResults);
    return { assets, nextToken: rows.length > filter.maxResults ? encodeToken(assets.at(-1)!) : null };
  }

  putToken(name: string, secret: string, at: Date): void {
    this.db
      .prepare("INSERT INTO tokens (name, hash, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at, last_used_at = NULL")
      .run(name, secretHash(secret), at.toISOString());
  }

  /** The token whose secret this is, marked used now. */
  tokenFor(secret: string, at: Date): TokenInfo | null {
    const row = this.db.prepare("SELECT name, created_at FROM tokens WHERE hash = ?").get(secretHash(secret)) as Row | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE tokens SET last_used_at = ? WHERE name = ?").run(at.toISOString(), row.name as string);
    return { name: row.name as string, createdAt: row.created_at as string, lastUsedAt: at.toISOString() };
  }

  hasToken(hash: string): boolean {
    return this.db.prepare("SELECT 1 FROM tokens WHERE hash = ?").get(hash) !== undefined;
  }

  tokens(): TokenInfo[] {
    return (this.db.prepare("SELECT name, created_at, last_used_at FROM tokens ORDER BY name").all() as Row[]).map((row) => ({
      name: row.name as string,
      createdAt: row.created_at as string,
      lastUsedAt: (row.last_used_at as string | null) ?? null,
    }));
  }

  /** Revokes a token and signs out every browser signed in with it. */
  revokeToken(name: string): boolean {
    const row = this.db.prepare("DELETE FROM tokens WHERE name = ? RETURNING hash").get(name) as Row | undefined;
    if (!row) return false;
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.hash as string);
    return true;
  }

  putSession(secret: string, tokenHash: string, name: string, at: Date, expiresAt: Date): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(at.toISOString());
    this.db.prepare("INSERT INTO sessions (hash, token_hash, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(secretHash(secret), tokenHash, name, at.toISOString(), expiresAt.toISOString());
  }

  /** The session a cookie's secret is, while it lasts: whose it is and the hash of the token that made it. */
  session(secret: string, at: Date): { name: string; tokenHash: string } | null {
    const row = this.db.prepare("SELECT name, token_hash FROM sessions WHERE hash = ? AND expires_at > ?").get(secretHash(secret), at.toISOString()) as Row | undefined;
    return row ? { name: row.name as string, tokenHash: row.token_hash as string } : null;
  }

  deleteSession(secret: string): void {
    this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(secretHash(secret));
  }

  putTicket(secret: string, upload: TicketUpload, at: Date, expiresAt: Date): void {
    this.db.prepare("DELETE FROM tickets WHERE expires_at <= ?").run(at.toISOString());
    this.db
      .prepare("INSERT INTO tickets (hash, asset_id, upload, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(secretHash(secret), upload.id, JSON.stringify(upload), upload.createdBy, at.toISOString(), expiresAt.toISOString());
  }

  /** Spends a ticket, once: what it was made for, or null when it is wrong, spent or expired. */
  spendTicket(secret: string, at: Date): TicketUpload | null {
    const row = this.db
      .prepare("UPDATE tickets SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ? RETURNING upload")
      .get(at.toISOString(), secretHash(secret), at.toISOString()) as Row | undefined;
    return row ? (JSON.parse(row.upload as string) as TicketUpload) : null;
  }
}
