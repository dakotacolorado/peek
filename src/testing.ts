import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { PeekApi } from "./api.ts";
import { DiskFiles } from "./files.ts";
import { Peek } from "./service.ts";
import { Store } from "./store.ts";

export const ADMIN = "admin-secret";
export const AGENT = "agent-secret";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

/** A temporary folder, removed after the test. */
export function temp(prefix = "peek-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export interface Init {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string | null;
  json?: unknown;
}

/** The API on a catalog in memory and files in a temporary folder, with the token `agent` and the admin's. */
export function setup(options: { publicUrl?: string | null; now?: () => Date } = {}) {
  const store = Store.open(":memory:");
  store.putToken("agent", AGENT, new Date());
  const files = temp();
  const peek = new Peek(store, new DiskFiles(files), options.now);
  const api = new PeekApi(peek, { version: "0.1.0", commit: "abc123" }, { adminToken: ADMIN, publicUrl: options.publicUrl ?? null });
  cleanups.push(() => store.close());
  const fetch = (path: string, init: Init = {}) =>
    api.fetch(
      new Request(`http://peek.test${path}`, {
        method: init.method ?? "GET",
        headers: { ...(init.json !== undefined && { "content-type": "application/json" }), ...init.headers },
        body: init.json !== undefined ? JSON.stringify(init.json) : (init.body ?? null),
      }),
    );
  const bearer = (token = AGENT) => ({ authorization: `Bearer ${token}` });
  /** Uploads `bytes` as the agent; answers the asset. */
  const put = async (name: string, bytes: Uint8Array | string, query: Record<string, string> = {}, headers: Record<string, string> = {}) => {
    const res = await fetch(`/api/assets?${new URLSearchParams({ name, ...query })}`, { method: "PUT", headers: { ...bearer(), ...headers }, body: typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes) });
    if (res.status !== 201) throw new Error(`PUT ${name}: ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown> & { id: string; name: string; fileUrl: string; link: string; contentType: string; size: number; sha256: string; createdBy: string };
  };
  return { api, store, peek, files, fetch, bearer, put };
}
