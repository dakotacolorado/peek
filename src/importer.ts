import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import type { Files } from "./files.ts";
import { assetOf, type Store } from "./store.ts";

export interface Imported {
  imported: number;
  /** Already here by id: imported before, or the same asset. */
  skipped: number;
  /** What could not come over, one line each. */
  problems: string[];
}

/**
 * Merges another peek's assets into this one: its catalog at `db` (opened
 * read-only, never changed) and the files under `files`. Each keeps its id,
 * so its old link's id resolves here; one already here is skipped, so a
 * second run changes nothing. A path asset comes over as its row alone.
 * Tokens, sessions and tickets stay behind.
 */
export async function importPeek(store: Store, into: Files, db: string, files: string): Promise<Imported> {
  const source = new DatabaseSync(db, { readOnly: true });
  const rows = (() => {
    try {
      return (source.prepare("SELECT * FROM assets ORDER BY created_at, id").all() as Record<string, unknown>[]).map(assetOf);
    } finally {
      source.close();
    }
  })();
  const result: Imported = { imported: 0, skipped: 0, problems: [] };
  for (const asset of rows) {
    if (store.asset(asset.id)) {
      result.skipped++;
      continue;
    }
    if (asset.path) {
      const held = store.assetByPath(asset.path);
      if (held) result.problems.push(`${asset.id}: its path ${asset.path} already is asset ${held.id} here`);
      else {
        store.putAsset(asset);
        result.imported++;
      }
      continue;
    }
    const file = join(files, asset.id, asset.name);
    if (!(await stat(file).catch(() => null))?.isFile()) {
      result.problems.push(`${asset.id}: no file at ${file}`);
      continue;
    }
    // The row only once its bytes are whole here, as every upload is.
    const written = await into.write(asset.id, asset.name, Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>);
    if (written.sha256 !== asset.sha256) {
      await into.remove(asset.id);
      result.problems.push(`${asset.id}: ${file} is not the bytes its catalog names (sha256 ${written.sha256}, not ${asset.sha256})`);
      continue;
    }
    store.putAsset(asset);
    result.imported++;
  }
  return result;
}
