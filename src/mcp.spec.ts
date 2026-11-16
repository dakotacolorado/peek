import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INLINE_MAX } from "./domain.ts";
import { mcpDocument, renderMcp, renderMcpHtml } from "./mcp-doc.ts";
import { MCP_DOC, MCP_FILE, MCP_PAGE } from "./spec.ts";
import { AGENT, setup } from "./testing.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function mcp() {
  const t = setup();
  const rpc = (method: string, params: unknown, headers: Record<string, string> = {}) =>
    t.fetch("/mcp", { method: "POST", headers: { ...t.bearer(AGENT), accept: "application/json, text/event-stream", ...headers }, json: { jsonrpc: "2.0", id: 1, method, params } });
  /** A tool's answer: its JSON, and whether it is an error. */
  const use = async <T = Record<string, unknown>>(name: string, args: unknown, headers: Record<string, string> = {}) => {
    const res = await rpc("tools/call", { name, arguments: args }, headers);
    expect(res.status).toBe(200);
    const { result } = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    // The SDK answers input its schema refuses in its own words, not JSON.
    const text = result.content[0]!.text;
    return { isError: result.isError === true, json: (text.startsWith("MCP error") ? { text } : JSON.parse(text)) as T };
  };
  return { ...t, rpc, use };
}

describe("the MCP server", () => {
  it("lists the asset tools, one per API operation an agent uses", async () => {
    const { tools } = await mcpDocument();
    expect(tools.map((tool) => tool.name)).toEqual(["upload_asset", "list_assets", "get_asset", "update_asset", "delete_asset"]);
    for (const tool of tools) for (const [name, field] of Object.entries(tool.inputSchema.properties ?? {})) expect(field.description, `${tool.name}.${name}`).toBeTruthy();
  });

  it("stores inline base64 content, as the caller and its x-actor", async () => {
    const t = mcp();
    const body = Buffer.from("not really a png");
    const { isError, json } = await t.use<{ id: string; link: string; sha256: string; contentType: string; createdBy: string; repo: string }>(
      "upload_asset",
      { name: "shot.png", content: body.toString("base64"), repo: "o/r", pr: 2, tags: ["x"] },
      { "x-actor": "implementer-x" },
    );
    expect(isError).toBe(false);
    expect(json).toMatchObject({ sha256: sha(body), contentType: "image/png", createdBy: "implementer-x", repo: "o/r" });
    expect(json.link).toBe(`http://peek.test/a/${json.id}`);
    expect(t.peek.find(json.id).size).toBe(body.length);
  });

  it("answers an uploadUrl and a curl needing no token when given no content; the URL works once", async () => {
    const t = mcp();
    const { isError, json } = await t.use<{ id: string; link: string; uploadUrl: string; curl: string; expiresAt: string }>("upload_asset", { name: "demo.mp4", task: "75d018b6" });
    expect(isError).toBe(false);
    expect(json.curl).toBe(`curl -fsS -T <file> '${json.uploadUrl}'`);
    expect(json.curl).not.toContain(AGENT);
    expect(json.link).toBe(`http://peek.test/a/${json.id}`);
    const path = new URL(json.uploadUrl).pathname;
    const up = await t.fetch(path, { method: "PUT", body: new Uint8Array([1, 2, 3]) });
    expect(up.status).toBe(201);
    expect(await up.json()).toMatchObject({ id: json.id, contentType: "video/mp4", task: "75d018b6", createdBy: "agent" });
    expect((await t.fetch(path, { method: "PUT", body: new Uint8Array([1]) })).status).toBe(403);
  });

  it("refuses content that is not base64, is empty, or is too large to take inline", async () => {
    const t = mcp();
    expect((await t.use("upload_asset", { name: "a.png", content: "not base64!" })).isError).toBe(true);
    expect((await t.use("upload_asset", { name: "a.png", content: "" })).isError).toBe(true);
    expect((await t.use("upload_asset", { name: "a.png", content: "A".repeat(INLINE_MAX + 4) })).isError).toBe(true);
    expect(t.store.assets({ maxResults: 10 }).assets).toEqual([]);
  });

  it("lists, gets, updates and deletes as the API does", async () => {
    const t = mcp();
    const a = await t.put("a.mp4", "1", { repo: "o/r", tags: "x,y" });
    const b = await t.put("b.png", "2", { repo: "o/r", tags: "x" });
    const ids = async (args: object) => (await t.use<{ assets: { id: string }[] }>("list_assets", args)).json.assets.map((x) => x.id);
    expect(await ids({ repo: "o/r" })).toEqual([b.id, a.id]);
    expect(await ids({ tags: ["x", "y"] })).toEqual([a.id]);
    expect(await ids({ contentType: "video/" })).toEqual([a.id]);
    const page = await t.use<{ assets: unknown[]; nextToken: string }>("list_assets", { maxResults: 1 });
    expect(await ids({ maxResults: 1, nextToken: page.json.nextToken })).toEqual([a.id]);
    expect((await t.use("get_asset", { id: a.id })).json).toEqual(a);
    expect((await t.use("update_asset", { id: a.id, title: "Clip", tags: ["z"] })).json).toMatchObject({ title: "Clip", tags: ["z"] });
    expect((await t.use("delete_asset", { id: a.id })).json).toMatchObject({ id: a.id });
    const gone = await t.use<{ code: string }>("get_asset", { id: a.id });
    expect(gone).toEqual({ isError: true, json: expect.objectContaining({ code: "ResourceNotFoundException" }) });
  });

  it("refuses a caller without a token", async () => {
    const t = mcp();
    expect((await t.rpc("tools/list", {}, { authorization: "Bearer wrong" })).status).toBe(401);
  });
});

describe("mcp.json, docs/MCP.md and docs/mcp.html", () => {
  it("match what the server lists", async () => {
    const served = await mcpDocument();
    expect(JSON.parse(readFileSync(MCP_FILE, "utf8"))).toEqual(served);
    expect(readFileSync(MCP_DOC, "utf8")).toBe(renderMcp(served));
    expect(readFileSync(MCP_PAGE, "utf8")).toBe(renderMcpHtml(served));
  });

  it("open by saying what peek is for and who uses the server", () => {
    expect(readFileSync(MCP_DOC, "utf8").split("\n")[4]).toMatch(/^peek keeps the images, videos and audio an agent makes .* for agents/);
  });
});
