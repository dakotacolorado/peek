import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeekApi } from "./api.ts";
import { DiskFiles } from "./files.ts";
import { INSTRUCTIONS, DOCS_URL } from "./mcp.ts";
import { Peek } from "./service.ts";
import { Store } from "./store.ts";

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  anyOf?: JsonSchema[];
  default?: unknown;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

export interface McpDocument {
  instructions: string;
  tools: McpTool[];
}

const SPEC_TOKEN = "spec";

/** The MCP server's tools, listed through the app as a client would, so the file cannot differ from what is served. */
export async function mcpDocument(): Promise<McpDocument> {
  const store = Store.open(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "peek-spec-"));
  const api = new PeekApi(new Peek(store, new DiskFiles(dir)), { version: "0", commit: "x" }, { adminToken: SPEC_TOKEN, publicUrl: null });
  const res = await api.fetch(
    new Request("http://local/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${SPEC_TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  const { result } = (await res.json()) as { result: { tools: McpTool[] } };
  store.close();
  rmSync(dir, { recursive: true, force: true });
  return { instructions: INSTRUCTIONS, tools: result.tools };
}

const CONFIG = { mcpServers: { peek: { type: "http", url: `${DOCS_URL}/mcp`, headers: { Authorization: "Bearer <your token>" } } } };
const ABOUT =
  "peek keeps the images, videos, audio, text and markdown an agent makes on its host, and serves each back by a link that plays or shows it in the person's browser (text and markdown up to 1 MB). Its MCP server is for agents: upload a file, small ones inline and large ones by a single-use upload URL that `curl` sends from the shell, and give the person its link; find, change and delete what was uploaded. " +
  "It is served at `/mcp` (streamable HTTP, stateless, answering JSON), under a token from `peek token create <name>`; each tool is one API request made with it, so it is refused and answered as that request would be. " +
  "A refusal comes back as the tool's error, in the API's words.";

const typeOf = (schema: JsonSchema): string => {
  if (schema.enum) return schema.enum.map((value) => `\`${String(value)}\``).join(", ");
  if (schema.const !== undefined) return `\`${String(schema.const)}\``;
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(" or ");
  if (schema.type === "array") return `${schema.items ? typeOf(schema.items) : "any"}[]`;
  return Array.isArray(schema.type) ? schema.type.join(" or ") : (schema.type ?? "any");
};

const cell = (text: string | undefined) => (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(schema: JsonSchema, prefix = ""): string[] {
  const rows: string[] = [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const required = schema.required?.includes(name) ? "yes" : "";
    rows.push(`| \`${prefix}${name}\` | ${cell(typeOf(property))} | ${required} | ${cell(property.description)} |`);
    if (property.type === "object" && property.properties) rows.push(...table(property, `${prefix}${name}.`));
  }
  return rows;
}

/** `docs/MCP.md`: the server's instructions, then each tool and its input. */
export function renderMcp(doc: McpDocument): string {
  const lines = [
    "# peek's MCP server",
    "",
    "<!-- Generated from src/mcp.ts by `npm run spec`; do not edit. -->",
    "",
    ABOUT,
    "",
    "```json",
    JSON.stringify(CONFIG, null, 2),
    "```",
    "",
    "## Instructions",
    "",
    "What the server tells an agent when it connects:",
    "",
    ...doc.instructions.split("\n").map((line) => (line ? `> ${line}` : ">")),
    "",
    "## Tools",
    "",
    "| Tool | Does | Reads only |",
    "| --- | --- | --- |",
    ...doc.tools.map((tool) => `| [\`${tool.name}\`](#${tool.name}) | ${cell(tool.title)} | ${tool.annotations?.readOnlyHint ? "yes" : ""} |`),
    "",
  ];
  for (const tool of doc.tools) {
    lines.push(`### ${tool.name}`, "", tool.description ?? "", "");
    const rows = table(tool.inputSchema);
    if (rows.length) lines.push("| Input | Type | Required | |", "| --- | --- | --- | --- |", ...rows, "");
    else lines.push("No input.", "");
  }
  return `${lines.join("\n")}`;
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Inline code in a description, as Markdown writes it. */
const inline = (text: string | undefined) => esc(text ?? "").replace(/`([^`]+)`/g, "<code>$1</code>");

function rowsHtml(schema: JsonSchema, prefix = ""): string[] {
  const rows: string[] = [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const required = schema.required?.includes(name) ? "yes" : "";
    rows.push(`<tr><td><code>${esc(prefix + name)}</code></td><td>${inline(typeOf(property))}</td><td>${required}</td><td>${inline(property.description)}</td></tr>`);
    if (property.type === "object" && property.properties) rows.push(...rowsHtml(property, `${prefix}${name}.`));
  }
  return rows;
}

/** `docs/mcp.html`, served at `/docs/mcp`: what `docs/MCP.md` says, as a page. */
export function renderMcpHtml(doc: McpDocument): string {
  const tools = doc.tools
    .map((tool) => {
      const rows = rowsHtml(tool.inputSchema);
      const input = rows.length
        ? `<table><thead><tr><th>Input</th><th>Type</th><th>Required</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`
        : "<p>No input.</p>";
      const read = tool.annotations?.readOnlyHint ? ' <span class="ro">reads only</span>' : "";
      return `<section id="${esc(tool.name)}"><h3><code>${esc(tool.name)}</code>${read}</h3><p>${inline(tool.description)}</p>${input}</section>`;
    })
    .join("\n");
  const index = doc.tools.map((tool) => `<li><a href="#${esc(tool.name)}"><code>${esc(tool.name)}</code></a> ${esc(tool.title ?? "")}</li>`).join("");
  const config = esc(JSON.stringify(CONFIG, null, 2));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>peek MCP server</title>
<!-- Generated from src/mcp.ts by \`npm run spec\`; do not edit. -->
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#1d1d1b}
code,pre{font-family:ui-monospace,monospace;font-size:13px}pre,blockquote{background:#f4f4f1;padding:10px 14px;border-radius:6px;overflow:auto}
blockquote{white-space:pre-wrap;margin:0}table{border-collapse:collapse;width:100%;margin:8px 0 20px}td,th{border:1px solid #e3e2dc;padding:4px 8px;text-align:left;vertical-align:top}
.ro{font-size:11px;border:1px solid #3f5468;color:#3f5468;border-radius:4px;padding:0 6px;font-weight:normal}section{border-top:1px solid #e3e2dc;padding-top:6px}
</style></head><body>
<h1>peek's MCP server</h1>
<p>${inline(ABOUT)} The contract is <a href="../mcp.json"><code>mcp.json</code></a>; the API's is <a href="./api">here</a>.</p>
<pre>${config}</pre>
<h2>Instructions</h2><p>What the server tells an agent when it connects:</p><blockquote>${esc(doc.instructions)}</blockquote>
<h2>Tools</h2><ul>${index}</ul>
${tools}
</body></html>
`;
}
