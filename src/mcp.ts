import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "@hono/zod-openapi";
import { TAGLINE } from "./banner.ts";
import { INLINE_MAX } from "./domain.ts";
import * as routes from "./schema.ts";

export const INSTRUCTIONS = `peek: ${TAGLINE} It keeps the images, videos, audio, text and markdown you make, on this host, and gives each a link that shows or plays it in the person's browser, on their phone too. Upload a screenshot, a screen recording, a sound or a report you want the person to see or hear or read: a \`.md\` report gets a link that shows it formatted, a \`.txt\`, \`.csv\` or \`.json\` file one that shows it as text (up to 1 MB; larger text offers a download), and give them its link (in a PR, a task comment or a message) instead of attaching the file.

- upload_asset takes the file's name and what it is for: repo (owner/name) and pr, task (a waypoint short id), title, tags. Give content (the file in base64) only for a small file, up to a few MB. For anything larger, give no content: it answers an uploadUrl and the exact curl command to run in your shell, which needs no token and works once, within the hour. Either way it answers the asset's link.
- Give the person link, never fileUrl: link is the page that plays it.
- list_assets finds what was uploaded, newest first, by repo, pr, task, tags, contentType prefix (video/), createdBy or text in q; pass nextToken for the next page.
- update_asset changes what an asset is of; delete_asset removes it and its file.
- Every tool takes the token this server was connected with.`;

/** The address the MCP docs give, a placeholder; served, the address they were reached at replaces it. */
export const DOCS_URL = "https://peek.example.com";

/** Sends one API request as the MCP request's caller: a JSON `body`, or raw `bytes` of a media type. */
export type Call = (method: string, path: string, init?: { body?: unknown; bytes?: Uint8Array; contentType?: string }) => Promise<Response>;

const query = (params: Record<string, string | number | string[] | undefined>) => {
  const set = Object.entries(params).flatMap(([key, value]): [string, string][] => (value === undefined ? [] : [[key, Array.isArray(value) ? value.join(",") : String(value)]]));
  return set.length ? `?${new URLSearchParams(set)}` : "";
};

/**
 * `shape` with each field's OpenAPI description as its own: `.openapi()`
 * keeps a description where zod's JSON Schema, which MCP lists, cannot see it.
 */
const described = <Shape extends z.ZodRawShape>(shape: Shape): Shape =>
  Object.fromEntries(
    Object.entries(shape).map(([name, core]) => {
      // A raw shape types its fields as zod's core type; ours are classic zod.
      const field = core as z.ZodType;
      const text = field.description ?? getOpenApiMetadata(field)?.description;
      return [name, text ? field.describe(text) : field];
    }),
  ) as unknown as Shape;

type Answer = { content: { type: "text"; text: string }[]; isError?: true };

/** A JSON answer as the tool's text; an API error is the tool's error, in the API's words. */
async function answer(res: Response): Promise<Answer> {
  const text = JSON.stringify(await res.json(), null, 2);
  return { content: [{ type: "text", text }], ...(res.status >= 400 && { isError: true as const }) };
}

const failure = (message: string): Answer => ({ content: [{ type: "text", text: JSON.stringify({ code: "ValidationException", message }) }], isError: true });

const IdShape = { id: routes.AssetSchema.shape.id };

const UploadShape = {
  ...routes.UploadSchema.shape,
  name: routes.Name.describe("The file's name, with its extension: no path."),
  content: z
    .base64()
    .max(INLINE_MAX)
    .optional()
    .describe(`The file, in base64, for a small one (at most ${INLINE_MAX.toLocaleString("en")} characters, about 12 MB). Leave it out to be given an uploadUrl and a curl command that uploads the file from your shell instead.`),
};

/** `ListAssets`'s filters, with tags as a list. */
const ListShape = { ...routes.ListQuery.shape, tags: z.array(z.string()).optional().describe("Only those carrying every one of these tags.") };

/**
 * The MCP server for one request: the API's asset operations, each a tool
 * made as one API request with the caller's own `authorization`, so it is
 * refused and recorded exactly as that request would be.
 */
export function mcpServer(version: string, call: Call): McpServer {
  const server = new McpServer({ name: "peek", version }, { instructions: INSTRUCTIONS });

  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    title: string,
    description: string,
    inputSchema: Shape,
    run: (input: z.infer<z.ZodObject<Shape>>) => Promise<Answer>,
    hints: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean } = {},
  ) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: described(inputSchema),
        annotations: { readOnlyHint: hints.readOnly ?? false, destructiveHint: hints.destructive ?? false, idempotentHint: hints.idempotent ?? false },
      },
      // The SDK types a tool's input by its own zod; these are the API's schemas, which it validates the same.
      run as never,
    );
  };

  tool(
    "upload_asset",
    "Upload an asset",
    "Keeps a file and answers its `link`, the page that shows or plays it, to give the person (a `.md` file shows formatted, other text as text, up to 1 MB). With `content` (base64, for a small file) it is stored now and the asset answered. Without it, answers an `uploadUrl` and the `curl` command that uploads the file from your shell: run it with `<file>` replaced by the file's path. It needs no token, works once within the hour, and answers the asset; the `link` answered now works once it has run.",
    UploadShape,
    async ({ content, contentType, ...upload }) => {
      if (content === undefined) return answer(await call("POST", "/api/uploads", { body: { ...upload, contentType } }));
      const bytes = Buffer.from(content, "base64");
      if (!bytes.length) return failure("content: empty; give the file's bytes in base64, or leave content out for an uploadUrl.");
      return answer(await call("PUT", `/api/assets${query(upload)}`, { bytes, contentType: contentType ?? "application/octet-stream" }));
    },
  );

  tool("list_assets", "List assets", routes.listRoute.description!, ListShape, async (input) => answer(await call("GET", `/api/assets${query(input)}`)), { readOnly: true });

  tool("get_asset", "Get an asset", "An asset, with its `link` and `fileUrl`.", IdShape, async ({ id }) => answer(await call("GET", `/api/assets/${id}`)), { readOnly: true });

  tool(
    "update_asset",
    "Update an asset",
    routes.updateRoute.description!,
    { ...IdShape, ...routes.UpdateSchema.shape },
    async ({ id, ...patch }) => answer(await call("PATCH", `/api/assets/${id}`, { body: patch })),
    { idempotent: true },
  );

  tool("delete_asset", "Delete an asset", routes.deleteRoute.description!, IdShape, async ({ id }) => answer(await call("DELETE", `/api/assets/${id}`)), { destructive: true, idempotent: true });

  return server;
}
