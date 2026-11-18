import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LETTERS_ONLY, MARK_ICON, MARK_PIXELS, MARK_SVG, SUMMARY, TAGLINE } from "./banner.ts";
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

  it("serves the eye as the tab's icon, without a token, and wears it in the header in blue", async () => {
    const res = await setup().fetch("/ui/mark.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toBe(MARK_ICON);
    const page = file("ui/index.html");
    expect(page).toContain('<link rel="icon" type="image/svg+xml" href="/ui/mark.svg?v=eye" />');
    expect(page).toContain(`<a class="brand" href="/">${MARK_SVG}peek</a>`);
    expect(file("ui/style.css")).toMatch(/\.brand \{[^}]*color: var\(--accent\)/);
  });

  it("gives the page banner.ts's words and mark, so the terminal and the page say the same", async () => {
    const res = await setup().fetch("/ui/banner.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    const body = await res.text();
    expect(body).toContain(`export const TAGLINE = ${JSON.stringify(TAGLINE)};`);
    expect(body).toContain(`export const SUMMARY = ${JSON.stringify(SUMMARY)};`);
    expect(body).toContain(`export const LETTERS = ${JSON.stringify(LETTERS_ONLY)};`);
    expect(body).toContain(`export const MARK_PIXELS = ${JSON.stringify(MARK_PIXELS)};`);
    expect(file("ui/app.js")).toContain('import { LETTERS, MARK_PIXELS, SUMMARY, TAGLINE } from "./banner.js";');
  });

  it("follows the system's light or dark", () => {
    const css = file("ui/style.css");
    expect(file("ui/index.html")).toContain('<meta name="color-scheme" content="light dark" />');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    // Every colour is a custom property, set once for light and once for dark.
    const rules = css.replace(/^:root \{[^}]*\}\n@media \(prefers-color-scheme: dark\) \{\n  :root \{[^}]*\}\n\}/, "");
    expect(rules).not.toBe(css);
    expect(rules).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
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

  it("offers a Download button for every asset, saving by ?download=1", () => {
    expect(file("ui/index.html")).toContain('<a id="download" class="button">Download</a>');
    const app = file("ui/app.js");
    expect(app).toContain("`${fileOf(asset)}?download=1`");
    expect(app).toContain('$("download").href = downloadOf(asset);');
    expect(app).toContain('$("download").download = asset.name;');
    expect(app).toContain('h("a", { href: downloadOf(asset), download: asset.name, class: "button" }');
  });

  it("plays video inline, and fits a phone with tap targets at least 44 pixels", () => {
    expect(file("ui/app.js")).toContain('h("video", { src: file, controls: true, playsinline: true');
    expect(file("ui/index.html")).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(file("ui/style.css")).toMatch(/input, select, button, \.button \{ min-height: 44px/);
  });
});
