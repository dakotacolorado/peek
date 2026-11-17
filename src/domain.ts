import { randomBytes } from "node:crypto";
import { extname } from "node:path";

/** A file peek keeps, and what it is of. */
export interface Asset {
  id: string;
  name: string;
  contentType: string;
  /** Its size in bytes; null while a path asset is pending. */
  size: number | null;
  /** Its SHA-256; null for a path asset, whose bytes peek never reads whole. */
  sha256: string | null;
  /** The file under the cellar root it was added by, or null when peek holds its bytes. */
  path: string | null;
  title: string | null;
  description: string | null;
  repo: string | null;
  pr: number | null;
  task: string | null;
  tags: string[];
  createdBy: string;
  createdAt: string;
}

/** `pending` while a path asset's file has not reached this host; `ready` once it plays. */
export type AssetState = "pending" | "ready";

/** An asset as it is now: its row and whether its file is here. */
export interface Shown extends Asset {
  state: AssetState;
}

/** What a caller says of an asset besides its bytes. */
export interface AssetMeta {
  title?: string | null;
  description?: string | null;
  repo?: string | null;
  pr?: number | null;
  task?: string | null;
  tags?: string[];
}

export interface AssetFilter {
  repo?: string;
  pr?: number;
  task?: string;
  /** Each of these: an asset must carry them all. */
  tags?: string[];
  /** A prefix of the content type, such as `video/`. */
  contentType?: string;
  createdBy?: string;
  /** Found in the name, title or description, ignoring ASCII case. */
  q?: string;
  maxResults: number;
  nextToken?: string;
}

/** A request the caller must change: answered with `status`, in these words. */
export class RequestError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 416;
  constructor(message: string, status: RequestError["status"] = 400) {
    super(message);
    this.status = status;
  }
}

export const NAME_MAX = 200;
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const TAG_MAX = 64;
export const TAGS_MAX = 20;
/** Base64 `content` an MCP upload takes inline: about 12 MB of file. Larger goes by `uploadUrl`. */
export const INLINE_MAX = 16_000_000;
/** How long an upload URL can be used, once. */
export const TICKET_SECONDS = 60 * 60;
/** How long a browser stays signed in. */
export const SESSION_SECONDS = 90 * 24 * 60 * 60;

/** A file name: no path, no control characters, not `.` or `..`. */
export const FILE_NAME = /^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$/;
export const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
export const TASK_PATTERN = /^[\w-]{1,64}$/;
/** A tag: no comma, since the API lists them comma-separated. */
export const TAG_PATTERN = /^[^,\u0000-\u001f\u007f]+$/;
/** A token's name, and so a caller's. */
export const TOKEN_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** An `x-actor` header taken as the creator; anything else is ignored. */
export const ACTOR_PATTERN = /^[\w.@:/-]{1,100}$/;

/** A short, URL-safe id: 72 random bits. */
export const newId = (): string => randomBytes(9).toString("base64url");
/** A secret: a session's or an upload ticket's, 192 random bits. */
export const newSecret = (): string => randomBytes(24).toString("base64url");

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".html": "text/html",
  ".csv": "text/csv",
};

/** Content types that say nothing of the file: what `fetch` or `curl --data-binary` send when not told. */
const UNSAID = new Set(["", "application/octet-stream", "application/x-www-form-urlencoded", "multipart/form-data"]);

/** The content type a request gives, unless it says nothing; else the file name's; else `application/octet-stream`. */
export function contentTypeOf(name: string, given: string | null | undefined): string {
  const type = (given ?? "").split(";")[0]!.trim().toLowerCase();
  if (!UNSAID.has(type) && /^[\w.+-]+\/[\w.+-]+$/.test(type)) return type;
  return TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
}

/** The caller's actor if it gives a well-formed one, else the caller's own name. */
export const creatorOf = (actor: string | undefined, caller: string): string => (actor && ACTOR_PATTERN.test(actor) ? actor : caller);

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * The one range a `Range` header asks of `size` bytes. `null` asks for the
 * whole file: no header, a malformed one, or several ranges, which a server
 * may answer whole. `"unsatisfiable"` starts past the end.
 */
export function rangeOf(header: string | undefined, size: number): ByteRange | null | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  if (from === "") {
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (to !== "" && Number(to) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end };
}
