import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "./build.ts";
import { banner, MARK_ICON, MARK_PIXELS, MARK_SVG, SUMMARY, TAGLINE, WORDMARK } from "./banner.ts";

const info = { version: "1.2.3", url: "http://127.0.0.1:4810", publicUrl: "https://beta:8451", db: "/data/peek.db", files: "/data/files", notes: [], color: false };

describe("banner", () => {
  it("carries the tagline and summary verbatim", () => {
    expect(TAGLINE).toBe("See what your agents made, wherever you are.");
    expect(SUMMARY).toBe("Keeps an agent's images, videos, audio, text and markdown where it made them, and serves them back by a link that plays or shows them in the browser, text up to 1 MB.");
  });

  it("is workplace-ui's eye, blue on the page and in the tab", () => {
    expect(MARK_SVG).toContain('viewBox="0 0 24 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M1 8C5 2 9 1 12 1S19 2 23 8C19 14 15 15 12 15S5 14 1 8Z" fill="var(--panel)"/><circle cx="12" cy="8" r="3.5" fill="currentColor"/>');
    expect(MARK_ICON).toContain("--ink:#1f5fa8");
    expect(MARK_ICON).toContain("@media (prefers-color-scheme:dark){svg{--ink:#7fb0e8");
  });

  it("sets the mark beside the letters, a row of text for each two of pixels", () => {
    expect(MARK_PIXELS).toHaveLength(12);
    expect(new Set(MARK_PIXELS.map((row) => row.length))).toEqual(new Set([16]));
    expect(MARK_PIXELS[0]).not.toContain("#");
    expect(MARK_PIXELS.at(-1)).not.toContain("#");
    expect(WORDMARK.split("\n")).toHaveLength(6);
    expect(WORDMARK.split("\n")[0]).toMatch(/^██████╗ ███████╗.*  +▄{6}$/);
  });

  it("says what peek is and where its page, API and MCP are, at the public address", () => {
    expect(banner(info).split("\n")).toEqual([
      "",
      ...WORDMARK.split("\n"),
      "v1.2.3",
      "",
      TAGLINE,
      SUMMARY,
      "",
      "  ▸ Page      https://beta:8451/",
      "  ▸ API       https://beta:8451/api/assets   docs https://beta:8451/docs/api",
      "  ▸ MCP       https://beta:8451/mcp          docs https://beta:8451/docs/mcp",
      "",
      "  listening on http://127.0.0.1:4810, files in /data/files, catalog in /data/peek.db",
      "  Ctrl+C to stop.",
      "",
    ]);
  });

  it("says its notes before where it listens", () => {
    expect(banner({ ...info, notes: ['Sign in with the admin token "dev".'] })).toContain('\n\nSign in with the admin token "dev".\n\n  listening on');
  });

  it("is painted in peek's blue only when color is on", () => {
    expect(banner(info)).not.toContain("\x1b");
    expect(banner({ ...info, notes: ["a note"] })).not.toContain("\x1b");
    expect(banner({ ...info, color: true })).toContain("\x1b[38;5;25m");
  });

  it("opens the README as peek prints it, up to where its parts are", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme.startsWith(`# peek\n\n**${TAGLINE}**\n\n`)).toBe(true);
    const printed = banner({ ...info, publicUrl: "https://peek.example.com", version: PACKAGE_VERSION });
    const opening = printed.slice(0, printed.indexOf("\n\n", printed.indexOf("▸ MCP"))).replace(/^\n+/, "");
    expect(readme).toContain(`\`\`\`\n${opening}\n\`\`\``);
    expect(readme).not.toMatch(/https?:\/\/(127\.0\.0\.1|localhost)/);
  });
});
