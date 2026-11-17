// peek's page: the gallery at /, filtered by the address's query, and the viewer at /a/<id>.
// A shell, the same for every asset and holding no data: it signs the browser in, then fetches
// what it shows. Every element is made with `h`, which sets text, never HTML.
import { LETTERS, MARK_PIXELS, SUMMARY, TAGLINE } from "./banner.js";

const $ = (id) => document.getElementById(id);

/** Filters the address keeps, each to `ListAssets`'s query; `type` is a media type's first part. */
const FILTERS = ["repo", "pr", "task", "type", "q"];

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(name, value === true ? "" : String(value));
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/** The mark drawn from banner.ts's pixel grid, a square a pixel, so it is the terminal's mark. */
function pixelMark() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [name, value] of Object.entries({ viewBox: `0 0 ${MARK_PIXELS[0].length} ${MARK_PIXELS.length}`, "shape-rendering": "crispEdges", fill: "currentColor", "aria-hidden": "true" })) svg.setAttribute(name, value);
  MARK_PIXELS.forEach((row, y) =>
    [...row].forEach((pixel, x) => {
      if (pixel !== "#") return;
      const rect = document.createElementNS(NS, "rect");
      for (const [name, value] of Object.entries({ x, y, width: 1, height: 1 })) rect.setAttribute(name, String(value));
      svg.append(rect);
    }),
  );
  return svg;
}

/** The block-letter name with the mark beside it, the tagline and the summary: atop the gallery, small, and the sign-in. */
function landing(small) {
  $("landing").className = `landing${small ? " small" : ""}`;
  $("landing").replaceChildren(
    h("a", { class: "wordmark", href: "/", "aria-label": "peek" }, h("pre", { "aria-hidden": "true" }, LETTERS), pixelMark()),
    h("p", { class: "tagline" }, TAGLINE),
    h("p", { class: "summary" }, SUMMARY),
  );
  $("landing").hidden = false;
}

function say(text) {
  $("status").textContent = text;
  $("status").hidden = !text;
}

// Signed in by a link whose address ends #signin=<token> (after any route, as #/a/<id>&signin=<token>):
// the token makes a session cookie, which media elements need, and leaves the address at once.
async function signInFromLink() {
  const given = /(?:^#|&)signin=([^&]+)/.exec(location.hash);
  if (!given) return true;
  const route = /^#(\/[^&]*)/.exec(location.hash)?.[1];
  history.replaceState(null, "", route ?? location.pathname + location.search);
  return signIn(decodeURIComponent(given[1]));
}

async function signIn(token) {
  const res = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return res.ok;
}

/** GETs a path of the API signed in by the cookie; null when signed out. */
async function get(path) {
  const res = await fetch(path);
  if (res.status === 401) {
    say("Sign in to see this.");
    landing(false);
    $("signin").hidden = false;
    $("token").focus();
    return null;
  }
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(res.status === 404 ? "Nothing is here: it was deleted, or not uploaded yet." : (error?.message ?? `peek answered ${res.status}.`));
  }
  return res.json();
}

const kindOf = (asset) => asset.contentType.split("/")[0];
const labelOf = (asset) => asset.title ?? asset.name;
const fileOf = (asset) => new URL(asset.fileUrl).pathname;
const isPicture = (asset) => kindOf(asset) === "image" && asset.contentType !== "image/svg+xml";

function sizeOf(bytes) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${n} bytes` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[unit]}`;
}

/** `/?repo=…&pr=…`: the gallery of one repository's pull request, or of the repository alone. */
function galleryOf(repo, pr) {
  const query = new URLSearchParams({ repo, ...(pr && { pr: String(pr) }) });
  return `/?${query}`;
}

// The gallery.

let nextToken = null;

function filters() {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(FILTERS.map((name) => [name, params.get(name) ?? ""]));
}

function query(given, token) {
  const params = new URLSearchParams();
  for (const name of ["repo", "pr", "task", "q"]) if (given[name]) params.set(name, given[name]);
  if (given.type) params.set("contentType", `${given.type}/`);
  if (token) params.set("nextToken", token);
  return params;
}

function tile(asset) {
  const kind = kindOf(asset);
  const preview = asset.state === "pending"
    ? h("span", { class: "kind pending" }, "Still arriving")
    : isPicture(asset)
    ? h("img", { src: fileOf(asset), alt: "", loading: "lazy" })
    : h("span", { class: `kind ${kind}` }, kind === "video" ? "▶ video" : kind === "audio" ? "♪ audio" : asset.contentType);
  const about = [asset.repo && (asset.pr ? `${asset.repo}#${asset.pr}` : asset.repo), new Date(asset.createdAt).toLocaleDateString()].filter(Boolean).join(" · ");
  return h("li", {}, h("a", { href: `/a/${asset.id}` }, h("div", { class: "preview" }, preview), h("span", { class: "label" }, labelOf(asset)), h("span", { class: "about" }, about)));
}

async function loadPage(given, token) {
  const page = await get(`/api/assets?${query(given, token)}`);
  if (!page) return;
  $("gallery").hidden = false;
  landing(true);
  $("grid").append(...page.assets.map(tile));
  nextToken = page.nextToken;
  $("more").hidden = !nextToken;
  say($("grid").children.length ? "" : FILTERS.some((name) => given[name]) ? "Nothing matches these filters." : "Nothing is here yet: agents upload through the API or MCP server.");
}

async function gallery() {
  const given = filters();
  const form = $("filters");
  for (const name of FILTERS) form.elements[name].value = given[name];
  $("clear").hidden = !FILTERS.some((name) => given[name]);
  document.title = given.repo ? `${given.pr ? `${given.repo}#${given.pr}` : given.repo} · peek` : "peek";
  $("grid").replaceChildren();
  await loadPage(given, null);
}

$("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  const params = new URLSearchParams();
  for (const name of FILTERS) {
    const value = event.target.elements[name].value.trim();
    if (value) params.set(name, value);
  }
  history.pushState(null, "", params.size ? `/?${params}` : "/");
  show();
});

$("more").addEventListener("click", () => {
  $("more").hidden = true;
  show(() => loadPage(filters(), nextToken));
});

// The viewer.

function media(asset) {
  if (asset.state === "pending") return h("p", { class: "pending", role: "status" }, "Still arriving: this file was written on another host and has not reached this one yet. This page reloads until it is here.");
  const file = fileOf(asset);
  const kind = kindOf(asset);
  if (isPicture(asset)) return h("a", { href: file, target: "_blank", title: "Full size" }, h("img", { src: file, alt: labelOf(asset) }));
  if (kind === "video") return h("video", { src: file, controls: true, playsinline: true, preload: "metadata" });
  if (kind === "audio") return h("audio", { src: file, controls: true, preload: "metadata" });
  return h("a", { href: file, download: asset.name, class: "button" }, `Download ${asset.name}`);
}

function detail(term, value) {
  return value === null || value === undefined || value === "" ? [] : [h("dt", {}, term), h("dd", {}, value)];
}

function link(href, text) {
  return h("a", { href, target: "_blank", rel: "noopener" }, text);
}

async function viewer(id) {
  const asset = await get(`/api/assets/${id}`);
  if (!asset) return;
  document.title = `${labelOf(asset)} · peek`;
  $("media").replaceChildren(media(asset));
  $("title").textContent = labelOf(asset);
  $("description").textContent = asset.description ?? "";
  $("description").hidden = !asset.description;
  $("open").href = fileOf(asset);
  if (asset.repo) {
    $("siblings").href = galleryOf(asset.repo, asset.pr);
    $("siblings").textContent = asset.pr ? `All of #${asset.pr}` : `All of ${asset.repo}`;
    $("siblings").hidden = false;
  }
  const repo = asset.repo && link(`https://github.com/${asset.repo}`, asset.repo);
  const pr = asset.repo && asset.pr && link(`https://github.com/${asset.repo}/pull/${asset.pr}`, `#${asset.pr}`);
  const task = asset.task && (asset.taskLink ? link(asset.taskLink, asset.task) : asset.task);
  $("details").replaceChildren(
    ...detail("Name", asset.name),
    ...detail("Size", asset.size === null ? null : sizeOf(asset.size)),
    ...detail("Type", asset.contentType),
    ...detail("Repository", repo),
    ...detail("Pull request", pr),
    ...detail("Task", task),
    ...detail("Tags", asset.tags.join(", ")),
    ...detail("Uploaded by", asset.createdBy),
    ...detail("Uploaded", new Date(asset.createdAt).toLocaleString()),
  );
  $("copy").onclick = () => copy(asset.link);
  $("viewer").hidden = false;
  say("");
  // Its file has not arrived: look again until it has, so the page plays it without a reload by hand.
  if (asset.state === "pending") {
    clearTimeout(arriving);
    arriving = setTimeout(() => {
      if (location.pathname === `/a/${id}`) viewer(id).catch((err) => say(err.message));
    }, PENDING_RELOAD_MS);
  }
}

/** How long a pending asset's page waits before it looks again. */
const PENDING_RELOAD_MS = 5000;
let arriving = null;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    $("copy").textContent = "Copied";
  } catch {
    // The clipboard is only for a secure page; elsewhere the link is offered to copy by hand.
    window.prompt("Copy this link:", text);
  }
  setTimeout(() => ($("copy").textContent = "Copy link"), 2000);
}

// Routing: the address's path picks the view.

async function show(run) {
  $("signin").hidden = true;
  if (!run) $("landing").hidden = true;
  try {
    if (run) return await run();
    const id = /^\/a\/([\w-]{12})$/.exec(location.pathname)?.[1];
    $("gallery").hidden = true;
    $("viewer").hidden = true;
    if (id) await viewer(id);
    else if (location.pathname === "/") await gallery();
    else say("Nothing is here.");
  } catch (err) {
    say(err.message);
  }
}

$("signin").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await signIn($("token").value)) {
    $("token").value = "";
    await show();
  } else say("That token is wrong or revoked.");
});

window.addEventListener("popstate", () => show());

if (await signInFromLink()) await show();
else {
  say("That sign-in link's token is wrong or revoked.");
  landing(false);
  $("signin").hidden = false;
}
