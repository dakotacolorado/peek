/**
 * `docs/API.md`: the API reference in the layout of an AWS one. For each
 * operation, its request syntax, parameters, body, response and errors; then
 * each data type. Generated from `openapi.json`, so it cannot drift.
 */

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  anyOf?: Schema[];
  allOf?: Schema[];
  nullable?: boolean;
  default?: unknown;
}

interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema: Schema;
}

interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: Parameter[];
  requestBody?: { description?: string; content: Record<string, { schema: Schema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: Schema }>; headers?: Record<string, { description?: string; schema: Schema }> }>;
}

export interface Document {
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

/** Request bodies and response wrappers, which their operations already set out in full. */
const hidden = (name: string) => /Input$|Response$/.test(name);

/** A body's content type and schema: JSON's when it has one. */
const content = (body: { content?: Record<string, { schema: Schema }> } | undefined) => {
  const entry = body?.content && (Object.entries(body.content).find(([type]) => type === "application/json") ?? Object.entries(body.content)[0]);
  return entry ? { type: entry[0], schema: entry[1].schema } : null;
};

const anchor = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * `doc` with each `allOf: [{$ref}, {description}]`, which zod writes for a
 * described reference, as the `{$ref, description}` it means.
 */
export function folded<T>(value: T): T {
  if (Array.isArray(value)) return value.map(folded) as T;
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).map(([key, each]) => [key, folded(each)] as const);
  const node = Object.fromEntries(entries) as Schema;
  if (node.allOf?.length === 2 && node.allOf[0]!.$ref && Object.keys(node.allOf[1]!).every((key) => key === "description")) {
    const { allOf, ...rest } = node;
    return { ...rest, $ref: allOf[0]!.$ref, description: allOf[1]!.description } as T;
  }
  return node as T;
}

export function renderApiReference(given: Document): string {
  const doc = folded(given);
  const schemas = doc.components.schemas;
  const named = (schema: Schema) => (schema.$ref ? schema.$ref.split("/").pop()! : null);
  const resolve = (schema: Schema): Schema => (schema.$ref ? schemas[named(schema)!]! : schema);
  const nullable = (schema: Schema) => schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes("null")) || (schema.anyOf ?? []).some((each) => each.type === "null");
  const bare = (schema: Schema): Schema => (schema.anyOf ? (schema.anyOf.find((each) => each.type !== "null") ?? schema) : schema);

  /** A value's skeleton in a request or response syntax, as AWS writes them. */
  const skeleton = (schema: Schema, depth: number, seen: string[]): string => {
    const name = named(schema);
    if (name && seen.includes(name)) return `{ ${name} }`;
    const s = bare(resolve(schema));
    const pad = "   ".repeat(depth + 1);
    if (s.enum) return `"${s.enum.join(" | ")}"`;
    if (s.const !== undefined) return JSON.stringify(s.const);
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
    if (type === "object" || s.properties) {
      const fields = Object.entries(s.properties ?? {}).map(([key, value]) => `${pad}"${key}": ${skeleton(value, depth + 1, name ? [...seen, name] : seen)}`);
      return fields.length ? `{\n${fields.join(",\n")}\n${"   ".repeat(depth)}}` : "{ }";
    }
    if (type === "array") return `[ ${skeleton(s.items ?? {}, depth, seen)} ]`;
    if (type === "integer" || type === "number") return "number";
    if (type === "boolean") return "boolean";
    if (type === "string") return '"string"';
    return "value";
  };

  const typeName = (schema: Schema): string => {
    const name = named(schema);
    if (name) return `[${name}](#${anchor(name)}) object`;
    const s = bare(schema);
    if (typeof s.const === "boolean" || (s.enum ?? []).every((v) => typeof v === "boolean") && s.enum?.length) return "Boolean";
    if (s.enum) return "String";
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
    if (type === "array") return `Array of ${s.items ? typeName(s.items).replace(/ object$/, " objects").replace(/^String$/, "strings") : "values"}`;
    if (type === "integer") return "Integer";
    if (type === "object") return "Object";
    return type ? type[0]!.toUpperCase() + type.slice(1) : "Any value";
  };

  /** A field as AWS lists it: its name, what it is, then its type and limits. */
  const field = (name: string, schema: Schema, required: boolean | null): string[] => {
    const s = bare(resolve(schema));
    const limits = [
      `Type: ${typeName(schema)}`,
      s.enum && typeof s.enum[0] !== "boolean" ? `Valid values: ${s.enum.map((v) => `\`${String(v)}\``).join(" | ")}` : null,
      s.maxLength !== undefined ? `Length: ${s.minLength ?? 0} to ${s.maxLength}` : s.minLength ? `Minimum length: ${s.minLength}` : null,
      s.maxItems !== undefined ? `At most ${s.maxItems} items` : null,
      s.minimum !== undefined || s.maximum !== undefined ? `Range: ${s.minimum ?? "any"} to ${s.maximum ?? "any"}` : null,
      s.pattern ? `Pattern: \`${s.pattern}\`` : null,
      nullable(schema) ? "Nullable: Yes" : null,
      required === null ? null : `Required: ${required ? "Yes" : "No"}`,
    ].filter(Boolean);
    const description = schema.description ?? s.description ?? "";
    return [`**${name}**  `, ...(description ? [`${description}  `] : []), `${limits.join(". ")}.`, ""];
  };

  const fields = (schema: Schema, required: boolean) => {
    const s = resolve(schema);
    return Object.entries(s.properties ?? {}).flatMap(([name, value]) => field(name, value, required ? (s.required ?? []).includes(name) : null));
  };

  const lines = [`# ${doc.info.title} API reference`, "", `API version ${doc.info.version}`, "", doc.info.description, "", "## Operations", ""];
  // Alphabetical, as AWS lists actions.
  const operations = Object.entries(doc.paths)
    .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })))
    .sort((a, b) => a.op.operationId.localeCompare(b.op.operationId));
  for (const { op } of operations) lines.push(`- [${op.operationId}](#${anchor(op.operationId)}): ${op.summary}`);
  lines.push("", "## Data types", "", ...Object.keys(schemas).filter((name) => !hidden(name)).sort().map((name) => `- [${name}](#${anchor(name)})`), "");

  for (const { path, method, op } of operations) {
    // The first success, by status: PostNotification answers 200 and 201 alike.
    const success = Object.entries(op.responses).find(([status]) => /^[12]/.test(status))!;
    const params = op.parameters ?? [];
    const query = params.filter((p) => p.in === "query").map((p) => `${p.name}=${p.name}`).join("&");
    const headers = params.filter((p) => p.in === "header").map((p) => `${p.name}: string`);
    const sent = content(op.requestBody);
    const got = content(success[1]);
    const body = sent?.type === "application/json" ? sent.schema : undefined;
    const response = got?.type === "application/json" ? got.schema : undefined;
    lines.push("---", "", `## ${op.operationId}`, "", op.description ?? `${op.summary}.`, "", "### Request syntax", "", "```http");
    lines.push(`${method.toUpperCase()} ${path}${query ? `?${query}` : ""} HTTP/1.1`, ...(op.security?.length ? ["Authorization: Bearer token"] : []), ...headers);
    if (body) lines.push("Content-type: application/json", "", skeleton(body, 0, []));
    else if (sent) lines.push(`Content-type: ${sent.type}`, "", op.requestBody?.description ?? "bytes");
    lines.push("```", "");
    for (const [where, title] of [["path", "URI request parameters"], ["query", "Query parameters"], ["header", "Request headers"]] as const) {
      const these = params.filter((p) => p.in === where);
      if (!these.length) continue;
      lines.push(`### ${title}`, "");
      for (const p of these) lines.push(...field(p.name, { ...p.schema, description: p.description ?? p.schema.description }, p.required === true));
    }
    if (body) lines.push("### Request body", "", ...fields(body, true));
    else if (sent) lines.push("### Request body", "", `${op.requestBody?.description ?? "The body"}, as \`${sent.type}\`.`, "");
    const answered = Object.entries(success[1].headers ?? {});
    lines.push("### Response syntax", "", "```http", `HTTP/1.1 ${success[0]}`, ...answered.map(([name]) => `${name}: string`));
    if (response) lines.push("Content-type: application/json", "", skeleton(response, 0, []));
    else if (got) lines.push(`Content-type: ${got.type}`, "", success[1].description);
    lines.push("```", "");
    if (response) lines.push("### Response elements", "", ...fields(response, false));
    else if (got) lines.push("### Response elements", "", `${success[1].description} As \`${got.type}\`.`, "");
    else lines.push(`${success[1].description}`, "");
    if (answered.length) {
      lines.push("### Response headers", "");
      for (const [name, header] of answered) lines.push(...field(name, { ...header.schema, description: header.description ?? header.schema.description }, null));
    }
    const errors = Object.entries(op.responses).filter(([status]) => !status.startsWith("2"));
    if (errors.length) {
      lines.push("### Errors", "");
      for (const [status, { description }] of errors) {
        const [code, ...cause] = description.split(": ");
        lines.push(`**${code}**  `, `${cause.join(": ")}  `, `HTTP status: ${status}`, "");
      }
    }
  }

  lines.push("---", "", "# Data types", "");
  for (const [name, schema] of Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))) {
    if (hidden(name)) continue;
    lines.push(`## ${name}`, "", ...(schema.description ? [schema.description, ""] : []), "### Contents", "", ...fields(schema, true));
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
