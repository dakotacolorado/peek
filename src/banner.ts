/** peek's mark: its name in block letters beside the mark, an eye: what an agent made, seen. */

const LETTERS = [
  "██████╗ ███████╗███████╗██╗  ██╗",
  "██╔══██╗██╔════╝██╔════╝██║ ██╔╝",
  "██████╔╝█████╗  █████╗  █████╔╝",
  "██╔═══╝ ██╔══╝  ██╔══╝  ██╔═██╗",
  "██║     ███████╗███████╗██║  ██╗",
  "╚═╝     ╚══════╝╚══════╝╚═╝  ╚═╝",
];

/**
 * The mark on a 16 by 12 grid: MARK_SVG's eye, its outline and pupil. The
 * first and last rows are blank so a terminal, drawing two rows a character,
 * gives it as many rows as the letters, the eye centred on them.
 */
export const MARK_PIXELS = [
  "................",
  ".....######.....",
  "...####..####...",
  "..##........##..",
  ".##...####...##.",
  "##....####....##",
  "##....####....##",
  ".##...####...##.",
  "..##........##..",
  "...####..####...",
  ".....######.....",
  "................",
];

/** The mark as text, two pixels a character, for terminals; the page draws MARK_PIXELS as an image instead. */
const MARK = Array.from({ length: MARK_PIXELS.length / 2 }, (_, row) =>
  [...MARK_PIXELS[row * 2]!]
    .map((top, col) => {
      const t = top === "#", b = MARK_PIXELS[row * 2 + 1]![col] === "#";
      return t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    })
    .join("")
    .trimEnd(),
);

/** The letters alone, for the page, which sets the mark beside them as an image. */
export const LETTERS_ONLY = LETTERS.join("\n");

const WIDTH = Math.max(...LETTERS.map((line) => line.length));
export const WORDMARK = LETTERS.map((line, i) => `${line.padEnd(WIDTH)}  ${MARK[i]}`.trimEnd()).join("\n");

/** peek's line, verbatim. */
export const TAGLINE = "See what your agents made, wherever you are.";
/** What peek is, in one line. Every place that describes peek in a line uses this or TAGLINE, verbatim. */
export const SUMMARY = "Keeps an agent's images, videos, audio, text and markdown where it made them, and serves them back by a link that plays or shows them in the browser, text up to 1 MB.";

/** The pixel mark as an SVG drawn from its grid, in the current color: beside the block letters. */
export const MARK_PIXEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 ${MARK_PIXELS[0]!.length} ${MARK_PIXELS.length}" shape-rendering="crispEdges" fill="currentColor">${MARK_PIXELS.flatMap((row, y) =>
  [...row].flatMap((pixel, x) => (pixel === "#" ? [`<rect x="${x}" y="${y}" width="1" height="1"/>`] : [])),
).join("")}</svg>`;

const EYE = "M1 8C5 2 9 1 12 1S19 2 23 8C19 14 15 15 12 15S5 14 1 8Z";

/** The mark drawn smooth, in the page's colors, for its header: the outline in the current color around the ground, and the pupil. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 24 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${EYE}" fill="var(--panel)"/><circle cx="12" cy="8" r="3.5" fill="currentColor"/></g></svg>`;

/**
 * The mark as the page's favicon: square, its outline and pupil heavier so it
 * reads at 16 pixels, blue on the tab's light or dark.
 */
export const MARK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="-1 -5 26 26"><style>svg{--ink:#1f5fa8;--ground:#fff}@media (prefers-color-scheme:dark){svg{--ink:#7fb0e8;--ground:#161615}}</style><g stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"><path d="${EYE}" fill="var(--ground)"/><circle cx="12" cy="8" r="4" fill="var(--ink)"/></g></svg>`;

/** Colors only for a terminal that wants them (https://no-color.org). peek's is blue, beside honed's teal, waypoint's terracotta and jobber's violet. */
export function palette(enabled: boolean) {
  const paint = (code: string) => (text: string) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { mark: paint("38;5;25"), bold: paint("1"), dim: paint("2") };
}

export interface BannerInfo {
  version: string;
  /** Where it listens. */
  url: string;
  /** Where people and agents reach it: its public URL, else `url`. */
  publicUrl: string;
  db: string;
  files: string;
  /** Lines to say before where it listens: how to sign in, or that no token is set. */
  notes: string[];
  color: boolean;
}

/** What peek says when it starts: what it is, and where its page, API and MCP server are. */
export function banner(b: BannerInfo): string {
  const c = palette(b.color);
  return [
    "",
    c.mark(WORDMARK),
    c.dim(`v${b.version}`),
    "",
    c.bold(TAGLINE),
    SUMMARY,
    "",
    `  ${c.mark("▸")} Page      ${b.publicUrl}/`,
    `  ${c.mark("▸")} API       ${b.publicUrl}/api/assets   docs ${b.publicUrl}/docs/api`,
    `  ${c.mark("▸")} MCP       ${b.publicUrl}/mcp          docs ${b.publicUrl}/docs/mcp`,
    "",
    ...(b.notes.length ? [...b.notes.map((note) => c.bold(note)), ""] : []),
    `  ${c.dim(`listening on ${b.url}, files in ${b.files}, catalog in ${b.db}`)}`,
    `  ${c.dim("Ctrl+C to stop.")}`,
    "",
  ].join("\n");
}
