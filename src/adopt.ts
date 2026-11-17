import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { Files } from "./files.ts";
import type { Store } from "./store.ts";

export interface Adopted {
  adopted: number;
  /** What could not be adopted, one line each; those assets are left as they are. */
  problems: string[];
}

/**
 * Makes every asset still served from a path one peek holds itself: its file
 * is copied into `files` under the name peek gives its own, its sha256 is
 * checked against the one the row has, if any, and its size and sha256 are
 * set and its path cleared in one statement. The id and link stay. A file
 * that is missing or does not match is listed and the asset left as it is, so
 * a second run adopts only what the first could not.
 */
export async function adoptPaths(store: Store, files: Files): Promise<Adopted> {
  const result: Adopted = { adopted: 0, problems: [] };
  for (const asset of store.pathAssets()) {
    const path = asset.path!;
    if (!(await stat(path).catch(() => null))?.isFile()) {
      result.problems.push(`${asset.id}: no file at ${path}`);
      continue;
    }
    try {
      const written = await files.write(asset.id, asset.name, Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>);
      if (asset.sha256 && written.sha256 !== asset.sha256) {
        await files.remove(asset.id);
        result.problems.push(`${asset.id}: ${path} is not the bytes its catalog names (sha256 ${written.sha256}, not ${asset.sha256})`);
        continue;
      }
      if (store.adopt(asset.id, path, written.size, written.sha256)) result.adopted++;
      else await files.remove(asset.id);
    } catch (err) {
      await files.remove(asset.id);
      result.problems.push(`${asset.id}: ${(err as Error).message}`);
    }
  }
  return result;
}
