import { createRoute, z } from "@hono/zod-openapi";
import { DESCRIPTION_MAX, FILE_NAME, NAME_MAX, REPO_PATTERN, TAG_MAX, TAG_PATTERN, TAGS_MAX, TASK_PATTERN, TITLE_MAX } from "./domain.ts";

/** Validates every request and generates `openapi.json`, so neither can drift. */

const Id = z
  .string()
  .regex(/^[\w-]{12}$/)
  .describe("The asset's id: 12 URL-safe characters.")
  .openapi({ example: "q3Xv9LmT0bZk" });
export const Name = z.string().min(1).max(NAME_MAX).regex(FILE_NAME).describe("The file's name, with its extension: no path.").openapi({ example: "login-flow.mp4" });
const Title = z.string().trim().min(1).max(TITLE_MAX).describe("What it shows, in a few words.").openapi({ example: "Login flow on iPhone" });
const Description = z.string().trim().min(1).max(DESCRIPTION_MAX).describe("More on what it shows, or what to look for.");
const Repo = z.string().regex(REPO_PATTERN).describe("The GitHub repository it is for, as `owner/name`.").openapi({ example: "dakotacolorado/peek" });
const Pr = z.int().min(1).describe("The pull request it is for, in `repo`.").openapi({ example: 12 });
const Task = z.string().regex(TASK_PATTERN).describe("The waypoint task it is for, by its short id.").openapi({ example: "75d018b6" });
const Tag = z.string().trim().min(1).max(TAG_MAX).regex(TAG_PATTERN).describe("A tag: any text without a comma.");
const Tags = z.array(Tag).max(TAGS_MAX).describe(`Tags, at most ${TAGS_MAX}.`).openapi({ example: ["before", "mobile"] });
/** What a request with a `path` is told: peek takes a file's bytes only. */
export const NO_PATH = "path: peek takes no path. Send the file's bytes as `content`, or leave `content` out to be given an upload URL.";
/** A `path` in a request is refused; absent, it is nothing. */
const NoPath = z
  .string()
  .refine(() => false, { error: NO_PATH })
  .optional()
  .describe("Refused: peek takes no path. Send the file's bytes, or ask for an upload URL.");
const ContentType = z.string().max(200).describe("Its media type, such as `video/mp4`.");

export const AssetSchema = z
  .object({
    id: Id,
    name: Name,
    contentType: ContentType.describe("Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's."),
    size: z.int().min(0).nullable().describe("Its size in bytes; null for a path asset not yet adopted."),
    sha256: z.string().nullable().describe("Its SHA-256, in hex; null for a path asset not yet adopted."),
    path: z.string().nullable().describe("The file a not yet adopted asset is still served from; null once peek holds its bytes."),
    title: Title.nullable(),
    description: Description.nullable(),
    repo: Repo.nullable(),
    pr: Pr.nullable(),
    task: Task.nullable(),
    tags: Tags,
    createdBy: z.string().describe("Who uploaded it: the uploader's `x-actor` header, else its token's name."),
    createdAt: z.string().describe("Uploaded at (ISO 8601)."),
    link: z.string().describe("Its page, which shows or plays it in the browser: the link to give the person."),
    taskLink: z.string().nullable().describe("Its task's page, when peek is given a task URL (`PEEK_TASK_URL`) and the asset a `task`; else null."),
    fileUrl: z.string().describe("Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token."),
  })
  .describe("A file peek keeps, and what it is of.")
  .openapi("Asset");

export const ERROR_CODES = {
  400: "ValidationException",
  401: "UnauthorizedException",
  403: "AccessDeniedException",
  404: "ResourceNotFoundException",
  409: "ConflictException",
  416: "RangeNotSatisfiableException",
  500: "InternalServerException",
} as const;

export type ErrorStatus = keyof typeof ERROR_CODES;

export const ErrorSchema = z
  .object({
    code: z.enum(Object.values(ERROR_CODES) as [string, ...string[]]).describe("Exception name."),
    message: z.string().describe("What went wrong."),
  })
  .describe("Every error's body.")
  .openapi("Error");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

/** An error answer, described as `<code>: <cause>`, which the reference lists as AWS's do. */
const fails = (status: ErrorStatus, cause: string) => json(ErrorSchema, `${ERROR_CODES[status]}: ${cause}`);

const FAILS = {
  400: fails(400, "The request failed validation."),
  401: fails(401, "No bearer token or session, or it is wrong, revoked or expired."),
};
const MISSING = { 404: fails(404, "No asset has that id.") };
const SIGNED_IN: Record<string, string[]>[] = [{ bearerAuth: [] }, { sessionCookie: [] }];
const signedIn = { security: SIGNED_IN, tags: ["Assets"] };

const IdParam = z.object({ id: Id.openapi({ param: { name: "id", in: "path" } }) });
const Bytes = z.string().openapi({ type: "string", format: "binary" });

/** A comma-separated list in a query. */
const TagList = z
  .string()
  .max(TAGS_MAX * (TAG_MAX + 1))
  .describe("Tags, comma-separated.")
  .openapi({ example: "before,mobile" });

/** What an upload says of its file, in `PutAsset`'s query. */
export const PutQuery = z.object({
  path: NoPath,
  name: Name,
  title: Title.optional(),
  description: Description.optional(),
  repo: Repo.optional(),
  pr: z.coerce.number().pipe(Pr).optional().describe("The pull request it is for, in `repo`."),
  task: Task.optional(),
  tags: TagList.optional(),
});

/** What an upload URL is made for, which `upload_asset` takes too. */
export const UploadSchema = z
  .object({
    path: NoPath,
    name: Name,
    contentType: ContentType.optional().describe("Its media type, such as `video/mp4`. Default: the name's extension's."),
    title: Title.optional(),
    description: Description.optional(),
    repo: Repo.optional(),
    pr: Pr.optional(),
    task: Task.optional(),
    tags: Tags.optional(),
  })
  .openapi("CreateUploadUrlInput");

export const UpdateSchema = z
  .object({
    title: Title.nullable().optional().describe("What it shows, in a few words; null clears it."),
    description: Description.nullable().optional().describe("More on what it shows; null clears it."),
    repo: Repo.nullable().optional().describe("The repository it is for, as `owner/name`; null clears it."),
    pr: Pr.nullable().optional().describe("The pull request it is for; null clears it."),
    task: Task.nullable().optional().describe("The waypoint task it is for; null clears it."),
    tags: Tags.optional().describe("Its tags, replacing those it had."),
  })
  .openapi("UpdateAssetInput");

/** `ListAssets`'s filters. */
export const ListQuery = z.object({
  repo: Repo.optional().describe("Only those for this repository."),
  pr: z.coerce.number().pipe(Pr).optional().describe("Only those for this pull request."),
  task: Task.optional().describe("Only those for this waypoint task."),
  tags: TagList.optional().describe("Only those carrying every one of these tags, comma-separated."),
  contentType: z.string().max(200).optional().describe("Only those whose media type starts with this, such as `video/` or `image/png`."),
  createdBy: z.string().max(100).optional().describe("Only those uploaded by this caller."),
  q: z.string().min(1).max(200).optional().describe("Only those whose name, title or description holds this text, ignoring case."),
  maxResults: z.coerce.number().int().min(1).max(200).default(50).describe("The most to answer. Default: 50."),
  nextToken: z.string().max(500).optional().describe("The `nextToken` a page answered, for the page after it."),
});

const TicketParam = z.object({
  ticket: z
    .string()
    .regex(/^[\w-]{32}$/)
    .describe("The upload ticket, as `CreateUploadUrl` gave it in `uploadUrl`.")
    .openapi({ param: { name: "ticket", in: "path" } }),
});

// --- routes -----------------------------------------------------------------

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "GetHealth",
  tags: ["Platform"],
  summary: "Get health",
  responses: {
    200: json(
      z
        .object({
          ok: z.literal(true).describe("Always true."),
          version: z.string().describe("Package version."),
          commit: z.string().describe("Commit it was built from."),
        })
        .openapi("Health"),
      "Service is up.",
    ),
  },
});

export const putRoute = createRoute({
  ...signedIn,
  method: "put",
  path: "/api/assets",
  operationId: "PutAsset",
  summary: "Put an asset",
  description:
    "Uploads a file: its bytes are the body, streamed to disk, so a file of any size can be sent; what it is of goes in the query. The `Content-Type` header gives its media type; without one, or with `application/octet-stream`, its name's extension does. Answers the asset with its `link`. For example, `curl -T clip.mp4 -H \"Authorization: Bearer $PEEK_TOKEN\" \"$PEEK_URL/api/assets?name=clip.mp4&repo=owner/name&pr=12\"`.",
  request: {
    query: PutQuery,
    body: { content: { "application/octet-stream": { schema: Bytes } }, description: "The file's bytes", required: true },
  },
  responses: { 201: json(AssetSchema, "Kept."), ...FAILS },
});

export const listRoute = createRoute({
  ...signedIn,
  method: "get",
  path: "/api/assets",
  operationId: "ListAssets",
  summary: "List assets",
  description: "Assets matching every filter given, newest first, a page at a time: while `nextToken` is not null, pass it for the next page.",
  request: { query: ListQuery },
  responses: {
    200: json(
      z
        .object({
          assets: z.array(AssetSchema).describe("This page's assets, newest first."),
          nextToken: z.string().nullable().describe("Pass it as `nextToken` for the next page; null on the last."),
        })
        .openapi("ListAssetsResponse"),
      "A page of assets.",
    ),
    ...FAILS,
  },
});

export const getRoute = createRoute({
  ...signedIn,
  method: "get",
  path: "/api/assets/{id}",
  operationId: "GetAsset",
  summary: "Get an asset",
  request: { params: IdParam },
  responses: { 200: json(AssetSchema, "The asset."), ...FAILS, ...MISSING },
});

export const updateRoute = createRoute({
  ...signedIn,
  method: "patch",
  path: "/api/assets/{id}",
  operationId: "UpdateAsset",
  summary: "Update an asset",
  description: "Sets what an asset is of: the fields given, leaving the rest. Its bytes and name do not change.",
  request: { params: IdParam, body: json(UpdateSchema, "The fields to set.") },
  responses: { 200: json(AssetSchema, "The asset as it now is."), ...FAILS, ...MISSING },
});

export const deleteRoute = createRoute({
  ...signedIn,
  method: "delete",
  path: "/api/assets/{id}",
  operationId: "DeleteAsset",
  summary: "Delete an asset",
  description: "Removes the asset from the catalog, then its file. Its link and file URL answer 404 after.",
  request: { params: IdParam },
  responses: { 200: json(AssetSchema, "The asset, as it was."), ...FAILS, ...MISSING },
});

export const createUploadRoute = createRoute({
  ...signedIn,
  method: "post",
  path: "/api/uploads",
  operationId: "CreateUploadUrl",
  summary: "Create upload URL",
  description:
    "Makes a URL that uploads one file, by these details, with no token: `curl -T <file> '<uploadUrl>'`. It works once, within the hour; the asset's id, and so its `link`, are fixed now and answer 404 until it is used. For an agent with a token in its MCP server's config only, so the file never passes through it.",
  request: { body: json(UploadSchema, "What the file will be.") },
  responses: {
    201: json(
      z
        .object({
          id: Id.describe("The asset's id, once uploaded."),
          link: z.string().describe("The asset's page, once uploaded."),
          uploadUrl: z.string().describe("PUT the file's bytes here, with no token, once."),
          curl: z.string().describe("The command that uploads it, for `<file>` the file's path."),
          expiresAt: z.string().describe("When `uploadUrl` stops working, if not used (ISO 8601)."),
        })
        .openapi("CreateUploadUrlResponse"),
      "The upload URL.",
    ),
    ...FAILS,
  },
});

export const putUploadRoute = createRoute({
  method: "put",
  path: "/api/uploads/{ticket}",
  operationId: "PutUpload",
  summary: "Put an upload",
  tags: ["Assets"],
  security: [],
  description:
    "Uploads the file an upload URL was made for: as `PutAsset`, but with no token, and the details given when the URL was made. The URL is spent by the first try, even one that fails; ask for another after that.",
  request: {
    params: TicketParam,
    body: { content: { "application/octet-stream": { schema: Bytes } }, description: "The file's bytes", required: true },
  },
  responses: {
    201: json(AssetSchema, "Kept."),
    400: fails(400, "The request failed validation."),
    403: fails(403, "The upload URL is wrong, already used or expired."),
  },
});

export const fileRoute = createRoute({
  security: SIGNED_IN,
  tags: ["Files"],
  method: "get",
  path: "/f/{id}/{name}",
  operationId: "GetFile",
  summary: "Get a file",
  description:
    "An asset's bytes, as its `fileUrl` gives them, with its media type, `Accept-Ranges: bytes` and an `ETag` of its SHA-256. A `Range` of one span (`bytes=0-1023`, `bytes=1024-`, `bytes=-1024`) answers 206 with just those bytes, so a browser plays and seeks a video. `<img>`, `<video>` and `<audio>` load it once the browser is signed in (`CreateSession`).",
  request: {
    params: z.object({
      id: Id.openapi({ param: { name: "id", in: "path" } }),
      name: Name.openapi({ param: { name: "name", in: "path" } }).describe("The asset's name, URL-encoded."),
    }),
    headers: z.object({ range: z.string().optional().describe("One span of bytes, such as `bytes=0-1023`.") }),
  },
  responses: {
    200: { content: { "*/*": { schema: Bytes } }, description: "The whole file." },
    206: { content: { "*/*": { schema: Bytes } }, description: "The span asked for, which `Content-Range` names." },
    401: FAILS[401],
    ...MISSING,
    416: fails(416, "The range starts past the end of the file."),
  },
});

export const SessionSchema = z
  .object({
    name: z.string().describe("Whose it is: the token's name."),
    expiresAt: z.string().describe("When it ends (ISO 8601)."),
  })
  .describe("A browser's sign-in.")
  .openapi("Session");

export const createSessionRoute = createRoute({
  security: [{ bearerAuth: [] }],
  tags: ["Sessions"],
  method: "post",
  path: "/api/session",
  operationId: "CreateSession",
  summary: "Create a session",
  description:
    "Signs a browser in: sets the `peek_session` cookie (HttpOnly, Secure, SameSite=Lax), which every other call then takes in place of the bearer token, for 90 days or until the token is revoked. A write signed in by the cookie alone must also send `x-peek: 1`.",
  responses: { 200: json(SessionSchema, "Signed in."), 401: fails(401, "The bearer token is missing, wrong or revoked.") },
});

export const deleteSessionRoute = createRoute({
  security: [{ sessionCookie: [] }],
  tags: ["Sessions"],
  method: "delete",
  path: "/api/session",
  operationId: "DeleteSession",
  summary: "Delete a session",
  description: "Signs the browser out: ends its session and clears the cookie.",
  responses: { 200: json(z.object({ ok: z.literal(true).describe("Always true.") }).openapi("DeleteSessionResponse"), "Signed out."), ...FAILS },
});

