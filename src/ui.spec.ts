import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setup } from "./testing.ts";

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the page", () => {
  it.each(["/", "/a/q3Xv9LmT0bZk", "/?repo=owner/name&pr=12"])("%s is the same shell, holding no data, under a CSP that runs only its own script", async (path) => {
    const t = setup();
    await t.put("secret-name.png", "x", { title: "Secret title" });
    const res = await t.fetch(path);
    const page = await res.text();
    expect(page).toBe(file("ui/index.html"));
    expect(page).not.toContain("Secret");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("serves its script and style without a token", async () => {
    const t = setup();
    for (const [path, type] of [["/ui/app.js", "text/javascript"], ["/ui/style.css", "text/css"]] as const) {
      const res = await t.fetch(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(type);
      expect(await res.text()).toBe(file(path.slice(1)));
    }
  });

  it("makes every element as text, never HTML", () => {
    for (const path of ["ui/app.js", "ui/index.html"]) expect(file(path)).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|eval\(|new Function/);
    expect(file("ui/index.html")).not.toMatch(/<script(?![^>]*\bsrc=)|\bon[a-z]+=/);
  });

  it("calls only paths the API has", async () => {
    const { paths } = (await (await setup().fetch("/openapi.json")).json()) as { paths: Record<string, unknown> };
    const known = Object.keys(paths).map((path) => path.replace(/\{\w+\}/g, "{x}"));
    // Each call's path, as `fetch("/api/session"` or `get(`/api/assets/${id}`)` writes it, its query dropped.
    const calls = [...file("ui/app.js").matchAll(/\b(?:fetch|get)\((["`])(.*?)\1/g)].map((m) => m[2]!.split("?")[0]!.replace(/\$\{[^}]+\}/g, "{x}"));
    expect([...new Set(calls)].sort()).toEqual(["/api/assets", "/api/assets/{x}", "/api/session"]);
    for (const path of calls) expect(known).toContain(path);
    // Files are reached only by the `fileUrl` the API answers.
    expect(file("ui/app.js")).not.toMatch(/["`]\/f\//);
  });

  it("keeps each gallery filter in the address, mapped to ListAssets's query", async () => {
    const app = file("ui/app.js");
    expect(app).toContain('const FILTERS = ["repo", "pr", "task", "type", "q"];');
    expect(app).toContain('params.set("contentType", `${given.type}/`)');
    expect(app).toContain("history.pushState");
    expect(app).toContain('params.set("nextToken", token)');
    const { paths } = (await (await setup().fetch("/openapi.json")).json()) as { paths: Record<string, { get?: { parameters?: { name: string }[] } }> };
    const query = paths["/api/assets"]!.get!.parameters!.map((p) => p.name);
    for (const name of ["repo", "pr", "task", "q", "contentType", "nextToken"]) expect(query).toContain(name);
    const page = file("ui/index.html");
    for (const name of ["repo", "pr", "task", "type", "q"]) expect(page).toContain(`name="${name}"`);
  });

  it("signs in from #signin=, after any route too, and then drops it from the address", () => {
    const app = file("ui/app.js");
    expect(app).toContain("/(?:^#|&)signin=([^&]+)/");
    expect(app).toMatch(/history\.replaceState\(null, "", route \?\? location\.pathname \+ location\.search\);\s*return signIn\(/);
    expect(app).toContain('fetch("/api/session", { method: "POST"');
  });

  it("plays video inline, and fits a phone with tap targets at least 44 pixels", () => {
    expect(file("ui/app.js")).toContain('h("video", { src: file, controls: true, playsinline: true');
    expect(file("ui/index.html")).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(file("ui/style.css")).toMatch(/input, select, button, \.button \{ min-height: 44px/);
  });
});
