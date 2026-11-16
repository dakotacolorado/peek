import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { newSecret, type ByteRange } from "./domain.ts";

export interface Written {
  size: number;
  sha256: string;
}

/**
 * Where an asset's bytes live, by its id and name. The catalog is the
 * store's; this holds only bytes, so another backend is one more class.
 */
export interface Files {
  /** Streams `body` in, never holding it whole; it appears under `id` only once complete. */
  write(id: string, name: string, body: ReadableStream<Uint8Array>): Promise<Written>;
  /** Its size, or null when it is not there. */
  size(id: string, name: string): Promise<number | null>;
  read(id: string, name: string, range?: ByteRange): ReadableStream<Uint8Array>;
  /** Removes what is under `id`; nothing there is not an error. */
  remove(id: string): Promise<void>;
}

/** Files on local disk: `<root>/<id>/<name>`, written first to `<root>/.uploads/`. */
export class DiskFiles implements Files {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async write(id: string, name: string, body: ReadableStream<Uint8Array>): Promise<Written> {
    const partial = join(this.root, ".uploads");
    await mkdir(partial, { recursive: true });
    const temp = join(partial, `${id}-${newSecret()}`);
    const hash = createHash("sha256");
    let size = 0;
    const count = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), count, createWriteStream(temp, { flags: "wx" }));
      await mkdir(join(this.root, id), { recursive: true });
      await rename(temp, join(this.root, id, name));
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
    return { size, sha256: hash.digest("hex") };
  }

  async size(id: string, name: string): Promise<number | null> {
    try {
      return (await stat(join(this.root, id, name))).size;
    } catch {
      return null;
    }
  }

  read(id: string, name: string, range?: ByteRange): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(join(this.root, id, name), range ?? {})) as ReadableStream<Uint8Array>;
  }

  async remove(id: string): Promise<void> {
    await rm(join(this.root, id), { recursive: true, force: true });
  }
}
