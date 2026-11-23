// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser module, no types
import { renderMarkdown, textKindOf } from "../ui/markdown.js";

const report = readFileSync(join(process.cwd(), "fixtures/report.md"), "utf8");
const render = (source: string): HTMLElement => renderMarkdown(source);

describe("renderMarkdown", () => {
  const out = render(report);
  const all = [...out.querySelectorAll("*")];

  it("renders the fixture report as elements", () => {
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "table", "th", "td", "ul", "ol", "li", "pre > code", "blockquote", "hr", "strong", "em"]) expect(out.querySelector(tag), tag).not.toBeNull();
    expect(out.querySelector('a[href^="https:"]')?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(out.querySelectorAll("th")).toHaveLength(3);
    expect(out.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(out.querySelector("ul ul li")?.textContent).toBe("nested bullet");
    expect(out.querySelector("ol ol li")?.textContent).toBe("nested number");
    expect(out.querySelector("pre code")?.className).toBe("language-js");
    expect(out.querySelector("td.align-right, th.align-right")).not.toBeNull();
    expect(out.textContent).not.toContain("**");
  });

  it("shows raw HTML as text and makes no script, image or event attribute", () => {
    expect(out.textContent).toContain("<script>alert(1)</script>");
    expect(out.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(out.textContent).toContain("<b>not bold</b>");
    expect(out.querySelector("script, img, b")).toBeNull();
    for (const el of all) for (const name of el.getAttributeNames()) expect(name.startsWith("on"), `${el.tagName} ${name}`).toBe(false);
  });

  it("renders a link other than http, https or mailto as its text", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "/relative", "ftp://x/y"]) {
      const el = render(`[click](${href})`);
      expect(el.querySelector("a"), href).toBeNull();
      expect(el.textContent).toBe("click");
    }
    expect(render("[m](mailto:a@b.c)").querySelector("a")?.getAttribute("href")).toBe("mailto:a@b.c");
    expect(render("![alt](https://x.test/i.png)").querySelector("img")).toBeNull();
    expect(render("![alt](https://x.test/i.png)").querySelector("a")?.textContent).toBe("alt");
  });

  it("keeps snake_case words and unclosed markers as text", () => {
    expect(render("a snake_case_name and 2 * 3").querySelector("em")).toBeNull();
  });

  it("holds no innerHTML anywhere in ui/", () => {
    for (const file of readdirSync(join(process.cwd(), "ui")).filter((f) => /\.(js|html)$/.test(f))) expect(readFileSync(join(process.cwd(), "ui", file), "utf8"), file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});

describe("textKindOf", () => {
  it.each([
    ["text/markdown", "markdown"],
    ["text/csv", "text"],
    ["text/plain", "text"],
    ["text/html", "text"],
    ["application/json", "text"],
    ["application/x-ndjson", "text"],
    ["application/yaml", "text"],
    ["application/xml", "text"],
    ["image/png", null],
    ["application/pdf", null],
  ])("%s is %s", (contentType, kind) => expect(textKindOf({ contentType })).toBe(kind));
});

describe("the viewer's size cap", () => {
  it("names 1 MB and keeps the Download button above it or with no size", () => {
    const app = readFileSync(join(process.cwd(), "ui/app.js"), "utf8");
    expect(app).toContain("const TEXT_VIEW_MAX = 1_000_000;");
    expect(app).toContain("asset.size === null || asset.size > TEXT_VIEW_MAX");
    expect(app).toContain("too large to show here");
  });
});
