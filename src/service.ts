import { createReadStream } from "node:fs";
import { realpath, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { contentTypeOf, FILE_NAME, NAME_MAX, newId, newSecret, RequestError, TICKET_SECONDS, type Asset, type AssetMeta, type ByteRange, type Shown } from "./domain.ts";
import { DiskFiles, type Files } from "./files.ts";
import type { Store, TicketUpload } from "./store.ts";

export interface Upload extends AssetMeta {
  name: string;
  /** The request's `Content-Type`, which the name's stands in for when it says nothing. */
  contentType?: string | null;
}

/** An asset added by a file already under the cellar root, which peek records and never copies. */
export interface PathUpload extends AssetMeta {
  path: string;
  /** Default: the path's last part. */
  name?: string;
  contentType?: string | null;
}

/** `path` is `root` or inside it. */
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * peek's rules over its catalog and files. An asset's bytes are written
 * whole before its row, and its row deleted before its bytes, so a row
 * always has its file.
 */
export class Peek {
  readonly store: Store;
  readonly files: Files;
  /** The folder a path asset's file must be under; null takes none. */
  readonly cellarRoot: string | null;
  private readonly now: () => Date;

  constructor(store: Store, files: Files, now: () => Date = () => new Date(), cellarRoot: string | null = null) {
    this.store = store;
    this.files = files;
    this.now = now;
    this.cellarRoot = cellarRoot && resolve(cellarRoot);
  }

  /**
   * Records a file under the cellar root as an asset, without reading or
   * copying it. The file may not be here yet: the asset is pending until it is.
   */
  async putPath(upload: PathUpload, createdBy: string): Promise<Shown> {
    const root = this.cellarRoot;
    if (!root) throw new RequestError("This peek takes no path: it has no cellar root (PEEK_CELLAR_ROOT). Upload the bytes instead.");
    if (!(await stat(root).catch(() => null))?.isDirectory()) throw new RequestError(`This peek's cellar root, ${root}, is not on its host: upload the bytes instead.`);
    if (!isAbsolute(upload.path)) throw new RequestError(`path: give an absolute path under ${root}, not ${upload.path}.`);
    const path = resolve(upload.path);
    if (path === root || !within(root, path)) throw new RequestError(`path: ${upload.path} is not under ${root}; write the file there, or upload its bytes.`);
    if (this.files instanceof DiskFiles && within(this.files.root, path)) throw new RequestError(`path: ${upload.path} is in peek's own files; write the file elsewhere under ${root}.`);
    const name = upload.name ?? basename(path);
    if (name.length > NAME_MAX || !FILE_NAME.test(name)) throw new RequestError(`name: ${JSON.stringify(name)} is not a file name; give one.`);
    const held = this.store.assetByPath(path);
    if (held) throw new RequestError(`path: asset ${held.id} already is ${path}.`, 409);
    const here = await stat(path).catch(() => null);
    if (here && !here.isFile()) throw new RequestError(`path: ${path} is not a file.`);
    const { path: _given, name: _name, contentType, ...meta } = upload;
    const asset: Asset = {
      id: newId(),
      name,
      contentType: contentTypeOf(name, contentType),
      size: null,
      sha256: null,
      path,
      title: meta.title ?? null,
      description: meta.description ?? null,
      repo: meta.repo ?? null,
      pr: meta.pr ?? null,
      task: meta.task ?? null,
      tags: [...new Set(meta.tags ?? [])],
      createdBy,
      createdAt: this.now().toISOString(),
    };
    this.store.putAsset(asset);
    return this.shown(asset);
  }

  /** Its file's size, or null while it is not here: a path asset's file must also still lie under the root, links and all. */
  async located(asset: Asset): Promise<number | null> {
    if (!asset.path) return this.files.size(asset.id, asset.name);
    if (!this.cellarRoot) return null;
    try {
      const [real, root] = await Promise.all([realpath(asset.path), realpath(this.cellarRoot)]);
      if (!within(root, real)) return null;
      const found = await stat(real);
      return found.isFile() ? found.size : null;
    } catch {
      return null;
    }
  }

  /** The asset with its state; a path asset's size is recorded once its file is found. */
  async shown(asset: Asset): Promise<Shown> {
    if (!asset.path) return { ...asset, state: "ready" };
    const size = await this.located(asset);
    if (size === null) return { ...asset, state: "pending" };
    if (size !== asset.size) this.store.setSize(asset.id, size);
    return { ...asset, size, state: "ready" };
  }

  /** Its bytes, or one span of them. */
  read(asset: Asset, range?: ByteRange): ReadableStream<Uint8Array> {
    if (!asset.path) return this.files.read(asset.id, asset.name, range);
    return Readable.toWeb(createReadStream(asset.path, range ?? {})) as ReadableStream<Uint8Array>;
  }

  /** Streams `body` to the files, then writes its row: the asset it made. */
  async put(upload: Upload, body: ReadableStream<Uint8Array> | null, createdBy: string, id: string = newId()): Promise<Asset> {
    if (!body) throw new RequestError("The body is empty: send the file's bytes as the request body.");
    const written = await this.files.write(id, upload.name, body);
    try {
      if (written.size === 0) throw new RequestError("The body is empty: send the file's bytes as the request body.");
      const asset: Asset = {
        id,
        name: upload.name,
        contentType: contentTypeOf(upload.name, upload.contentType),
        size: written.size,
        sha256: written.sha256,
        path: null,
        title: upload.title ?? null,
        description: upload.description ?? null,
        repo: upload.repo ?? null,
        pr: upload.pr ?? null,
        task: upload.task ?? null,
        tags: [...new Set(upload.tags ?? [])],
        createdBy,
        createdAt: this.now().toISOString(),
      };
      this.store.putAsset(asset);
      return asset;
    } catch (err) {
      await this.files.remove(id);
      throw err;
    }
  }

  find(id: string): Asset {
    const asset = this.store.asset(id);
    if (!asset) throw new RequestError(`No asset ${id}.`, 404);
    return asset;
  }

  update(id: string, patch: AssetMeta): Asset {
    const asset = this.store.updateAsset(id, { ...patch, ...(patch.tags && { tags: [...new Set(patch.tags)] }) });
    if (!asset) throw new RequestError(`No asset ${id}.`, 404);
    return asset;
  }

  async delete(id: string): Promise<Asset> {
    const asset = this.find(id);
    this.store.deleteAsset(id);
    // Only a file still under the root this peek is given: a path recorded under another root is left be.
    if (asset.path) {
      if (this.cellarRoot && within(this.cellarRoot, asset.path)) await rm(asset.path, { force: true });
    }
    else await this.files.remove(id);
    return asset;
  }

  /** A single-use ticket to upload one asset, by these details, within the hour; the asset's id is fixed now. */
  ticket(upload: Upload, createdBy: string): { secret: string; upload: TicketUpload; expiresAt: Date } {
    const at = this.now();
    const expiresAt = new Date(at.getTime() + TICKET_SECONDS * 1000);
    const secret = newSecret();
    const ticketed: TicketUpload = { ...upload, contentType: upload.contentType ?? null, tags: [...new Set(upload.tags ?? [])], id: newId(), createdBy };
    this.store.putTicket(secret, ticketed, at, expiresAt);
    return { secret, upload: ticketed, expiresAt };
  }

  /** Spends the ticket, then uploads by it; a ticket is spent even when its upload then fails. */
  async putByTicket(secret: string, body: ReadableStream<Uint8Array> | null, contentType: string | null): Promise<Asset> {
    const upload = this.store.spendTicket(secret, this.now());
    if (!upload) throw new RequestError("This upload URL is wrong, already used or expired: ask upload_asset for another.", 403);
    return this.put({ ...upload, contentType: upload.contentType ?? contentType }, body, upload.createdBy, upload.id);
  }
}
