import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setup } from "./testing.ts";

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the viewer's shell", () => {
  it("is the same page for every asset, holding no data, under a CSP that runs only its own script", async () => {
    const t = setup();
    const asset = await t.put("secret-name.png", "x", { title: "Secret title" });
    const res = await t.fetch(`/a/${asset.id}`);
    const page = await res.text();
    expect(page).toBe(file("ui/index.html"));
    expect(page).not.toContain("Secret");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("makes every element as text, never HTML", () => {
    expect(file("ui/app.js")).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("signs in from #signin= and then drops it from the address", () => {
    const app = file("ui/app.js");
    expect(app).toContain('get("signin")');
    expect(app).toContain("history.replaceState");
  });
});
