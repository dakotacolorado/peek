// A small markdown renderer for peek's viewer. It builds elements with createElement and text nodes
// only: no HTML is parsed, so raw HTML in the source is shown as literal text, and no library is used.

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(name, String(value));
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** A link's address when it is http, https or mailto, else null. */
function safeHref(raw) {
  try {
    const url = new URL(raw.trim());
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function anchor(href, ...children) {
  const safe = safeHref(href);
  return safe ? h("a", { href: safe, rel: "noopener noreferrer", target: "_blank" }, ...children) : h("span", {}, ...children);
}

// Inline: code spans, images, links, bold and italic, found left to right.
const INLINE = [
  { re: /^(`+)([\s\S]+?)\1(?!`)/, make: (m) => h("code", {}, m[2].trim()) },
  { re: /^!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()]*\))*)(?:\s+"[^"]*")?\s*\)/, make: (m) => (safeHref(m[2]) ? anchor(m[2], m[1] || m[2]) : m[1] || m[2]) },
  { re: /^\[((?:[^\]\\]|\\.)*)\]\(\s*((?:[^()\s]|\([^()]*\))*)(?:\s+"[^"]*")?\s*\)/, make: (m) => anchor(m[2], ...inline(m[1])) },
  { re: /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/, make: (m) => h("strong", {}, ...inline(m[2])) },
  { re: /^(\*|_)(?=\S)([\s\S]*?\S)\1/, make: (m) => h("em", {}, ...inline(m[2])) },
  { re: /^~~(?=\S)([\s\S]*?\S)~~/, make: (m) => h("del", {}, ...inline(m[1])) },
  { re: /^<(https?:\/\/[^\s>]+)>/, make: (m) => anchor(m[1], m[1]) },
  { re: /^\\([\\`*_{}[\]()#+\-.!|>~<])/, make: (m) => m[1] },
];

function inline(text) {
  const out = [];
  let plain = "";
  let rest = text;
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  while (rest) {
    const found = /[`!\[*_~<\\]/.test(rest[0]) && !(rest[0] === "_" && /\w$/.test(plain)) ? INLINE.map((rule) => [rule, rule.re.exec(rest)]).find(([, m]) => m) : null;
    if (found) {
      const [rule, m] = found;
      flush();
      out.push(rule.make(m));
      rest = rest.slice(m[0].length);
    } else {
      plain += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function cells(line) {
  const parts = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/);
  return parts.map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || ITEM.test(line) || QUOTE.test(line);

function list(items) {
  // Items at the first item's indent are the list's; deeper ones nest one level under the item before.
  const base = items[0].indent;
  const build = (group) => h(/^\d/.test(group[0].marker) ? "ol" : "ul", {});
  let top = null;
  let nested = null;
  for (const item of items) {
    if (item.indent > base && top) {
      const li = h("li", {}, ...inline(item.text));
      if (!nested || nested.tag !== (/^\d/.test(item.marker) ? "ol" : "ul")) {
        nested = { tag: /^\d/.test(item.marker) ? "ol" : "ul", node: build([item]) };
        top.lastChild.append(nested.node);
      }
      nested.node.append(li);
    } else {
      if (!top) top = build([item]);
      top.append(h("li", {}, ...inline(item.text)));
      nested = null;
    }
  }
  return top;
}

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && lines[i].trim().replace(new RegExp(`^\\${fence[1][0]}+`), "") === "")) body.push(lines[i++]);
      i += 1;
      const lang = fence[2].replace(/[^\w-]/g, "");
      out.push(h("pre", {}, h("code", { class: lang ? `language-${lang}` : null }, body.join("\n"))));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push(h(`h${heading[1].length}`, {}, ...inline(heading[2])));
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push(h("hr"));
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i++])[1]);
      out.push(h("blockquote", {}, ...blocks(inner)));
      continue;
    }
    if (ITEM.test(line)) {
      const items = [];
      while (i < lines.length && (ITEM.test(lines[i]) || (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length && !startsBlock(lines[i])))) {
        const m = ITEM.exec(lines[i]);
        if (m) items.push({ indent: m[1].replace(/\t/g, "    ").length, marker: m[2], text: m[3] });
        else items[items.length - 1].text += ` ${lines[i].trim()}`;
        i += 1;
      }
      out.push(list(items));
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && DIVIDER.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const cell = (tag, text, n) => h(tag, { class: align[n] ? `align-${align[n]}` : null }, ...inline(text));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
      out.push(
        h("div", { class: "table-box" }, h("table", {}, h("thead", {}, h("tr", {}, ...head.map((c, n) => cell("th", c, n)))), h("tbody", {}, ...rows.map((row) => h("tr", {}, ...head.map((_, n) => cell("td", row[n] ?? "", n))))))),
      );
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++].trim());
    out.push(h("p", {}, ...inline(para.join("\n"))));
  }
  return out;
}

/** The report in `source` as a `div.markdown` of elements. */
export function renderMarkdown(source) {
  return h("div", { class: "markdown" }, ...blocks(source.replace(/\r\n?/g, "\n").split("\n")));
}

const TEXT_TYPES = new Set(["application/json", "application/x-ndjson", "application/yaml", "application/x-yaml", "application/xml"]);

/** `"markdown"` for markdown, `"text"` for any other type the viewer shows as text, else null. */
export function textKindOf(asset) {
  const type = asset.contentType.toLowerCase();
  if (type === "text/markdown") return "markdown";
  return type.startsWith("text/") || TEXT_TYPES.has(type) ? "text" : null;
}

