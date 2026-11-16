import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderApiReference, type Document } from "./api-doc.ts";
import { PeekApi, SPEC_PATH } from "./api.ts";
import { DiskFiles } from "./files.ts";
import { mcpDocument, renderMcp, renderMcpHtml } from "./mcp-doc.ts";
import { Peek } from "./service.ts";
import { Store } from "./store.ts";

/**
 * Writes `openapi.json`. Committed so clients generate without a deploy and
 * contract changes surface in review.
 */
export const SPEC_FILE = fileURLToPath(new URL("../openapi.json", import.meta.url));

const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
/** The AWS-layout reference, from `openapi.json`; and Redoc's page of it, served at `/docs/api`, by redocly in `npm run spec`. */
export const API_DOC = at("docs/API.md");
export const API_PAGE = at("docs/index.html");
/** The MCP server's contract and docs, from its own `tools/list`. */
export const MCP_FILE = at("mcp.json");
export const MCP_DOC = at("docs/MCP.md");
export const MCP_PAGE = at("docs/mcp.html");

/** Fetched through the app, so the file cannot differ from what is served. */
export async function openApiDocument(): Promise<Document> {
  const store = Store.open(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "peek-spec-"));
  const api = new PeekApi(new Peek(store, new DiskFiles(dir)), { version: "0", commit: "x" }, { adminToken: null, publicUrl: null });
  const doc = await (await api.fetch(new Request(`http://local${SPEC_PATH}`))).json();
  store.close();
  rmSync(dir, { recursive: true, force: true });
  return doc as Document;
}

if (import.meta.main) {
  const doc = await openApiDocument();
  writeFileSync(SPEC_FILE, `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(API_DOC, renderApiReference(doc));
  const mcp = await mcpDocument();
  writeFileSync(MCP_FILE, `${JSON.stringify(mcp, null, 2)}\n`);
  writeFileSync(MCP_DOC, renderMcp(mcp));
  writeFileSync(MCP_PAGE, renderMcpHtml(mcp));
  console.log(`wrote ${SPEC_FILE}, ${API_DOC}, ${MCP_FILE}, ${MCP_DOC} and ${MCP_PAGE}`);
}
