import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { contentTypeOf, newId, newSecret, RequestError, TICKET_SECONDS, type Asset, type AssetMeta, type ByteRange } from "./domain.ts";
import type { Files } from "./files.ts";
import type { Store, TicketUpload } from "./store.ts";

export interface Upload extends AssetMeta {
  name: string;
  /** The request's `Content-Type`, which the name's stands in for when it says nothing. */
  contentType?: string | null;
}

/**
 * peek's rules over its catalog and files. An asset's bytes are written
 * whole before its row, and its row deleted before its bytes, so a row
 * always has its file.
 */
export class Peek {
  readonly store: Store;
  readonly files: Files;
  private readonly now: () => Date;

  constructor(store: Store, files: Files, now: () => Date = () => new Date()) {
    this.store = store;
    this.files = files;
    this.now = now;
  }

  /** Its file's size, or null while it is not here. A path asset not yet adopted is served from its path. */
  async located(asset: Asset): Promise<number | null> {
    if (!asset.path) return this.files.size(asset.id, asset.name);
    try {
      const found = await stat(asset.path);
      return found.isFile() ? found.size : null;
    } catch {
      return null;
    }
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
    // A path asset's file is not peek's to remove.
    if (!asset.path) await this.files.remove(id);
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
