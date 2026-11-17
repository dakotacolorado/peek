import { mkdirSync } from "node:fs";
import { PeekApi } from "./api.ts";
import { buildOf, PACKAGE_VERSION } from "./build.ts";
import { DiskFiles } from "./files.ts";
import { Peek } from "./service.ts";
import { Store } from "./store.ts";

export interface Config {
  /** The SQLite catalog; `:memory:` keeps nothing past the process. */
  db: string;
  /** The folder the files live in. */
  files: string;
  /** The folder a path asset's file must be under, such as `/cellar/peek`; null takes no path. */
  cellarRoot?: string | null;
  /** A token named `admin`, beside those in the database. */
  adminToken: string | null;
  /** The base every link is built on. */
  publicUrl: string | null;
  /** A task's page, `{task}` standing for its id. */
  taskUrl?: string | null;
}

export interface Running {
  api: PeekApi;
  peek: Peek;
  store: Store;
  close(): void;
}

/** The API over the catalog at `config.db` and the files under `config.files`. */
export function start(config: Config): Running {
  mkdirSync(config.files, { recursive: true });
  const store = Store.open(config.db);
  const peek = new Peek(store, new DiskFiles(config.files), undefined, config.cellarRoot ?? null);
  const api = new PeekApi(peek, { version: PACKAGE_VERSION, commit: buildOf().commit }, { adminToken: config.adminToken, publicUrl: config.publicUrl, taskUrl: config.taskUrl ?? null });
  return { api, peek, store, close: () => store.close() };
}
