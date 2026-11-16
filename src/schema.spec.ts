import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { folded, renderApiReference } from "./api-doc.ts";
import { ERROR_CODES } from "./schema.ts";
import { API_DOC, API_PAGE, openApiDocument, SPEC_FILE } from "./spec.ts";
import { setup } from "./testing.ts";

const operations = async () => Object.values((await openApiDocument()).paths).flatMap((methods) => Object.values(methods));

describe("openapi.json", () => {
  it("matches what the service serves", async () => {
    expect(JSON.parse(readFileSync(SPEC_FILE, "utf8"))).toEqual(await openApiDocument());
  });

  it("names every operation in AWS's VerbNoun form, with a summary of two or three words that starts with the same verb", async () => {
    for (const op of await operations()) {
      expect(op.operationId).toMatch(/^(Get|List|Put|Create|Update|Delete)[A-Z][A-Za-z]+$/);
      expect(op.summary.split(" ")[0]).toBe(op.operationId.match(/^[A-Z][a-z]+/)![0]);
      expect(op.summary.split(" ").length, op.summary).toBeGreaterThanOrEqual(2);
      expect(op.summary.split(" ").length, op.summary).toBeLessThanOrEqual(3);
    }
  });

  it("documents every field of every data type", async () => {
    // A described reference is `allOf: [{$ref}, {description}]`, as the reference reads it.
    const { components } = folded(await openApiDocument());
    const undocumented = Object.entries(components.schemas).flatMap(([name, schema]) =>
      Object.entries(schema.properties ?? {})
        .filter(([, field]) => !field.description && !field.$ref)
        .map(([field]) => `${name}.${field}`),
    );
    expect(undocumented).toEqual([]);
  });

  it("names each error answer for its exception, as `<code>: <cause>`", async () => {
    for (const op of await operations()) {
      for (const [status, { description }] of Object.entries(op.responses)) {
        if (Number(status) >= 400) expect(`${op.operationId} ${status} ${description}`).toMatch(new RegExp(`^${op.operationId} ${status} ${ERROR_CODES[Number(status) as keyof typeof ERROR_CODES]}: .`));
      }
    }
  });

  it("opens by saying what peek is for and who calls it", async () => {
    const { info } = await openApiDocument();
    expect(info.description).toMatch(/^Keeps an agent's images, videos and audio where it made them, and serves them back by a link that plays in the browser\. \*\*Agents\*\*/);
  });
});

describe("docs/API.md and docs/index.html", () => {
  it("render the served openapi.json", async () => {
    const served = await openApiDocument();
    expect(readFileSync(API_DOC, "utf8")).toBe(renderApiReference(served));
    // Redoc's page carries the document it renders.
    const embedded = /const __redoc_definition = (.*);\n/.exec(readFileSync(API_PAGE, "utf8"))?.[1];
    expect(JSON.parse(embedded ?? "null")).toEqual(served);
  });

  it("set out every operation with its request, response and errors, then every data type", async () => {
    const reference = renderApiReference(await openApiDocument());
    for (const op of await operations()) {
      const section = reference.split(`\n## ${op.operationId}\n`)[1]!.split("\n---\n")[0]!;
      expect(section).toContain("### Request syntax");
      expect(section).toContain("### Response syntax");
      if (Object.keys(op.responses).some((status) => !status.startsWith("2"))) expect(section).toContain("### Errors");
    }
    expect(reference.split("\n# Data types\n")[1]).toContain("\n## Asset\n");
  });

  it("serves /docs/api as the page", async () => {
    const res = await setup().fetch("/docs/api");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe(readFileSync(API_PAGE, "utf8"));
  });
});
