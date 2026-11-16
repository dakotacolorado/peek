// The viewer's shell: the same for every asset, holding no data. It signs the
// browser in from `#signin=<token>` or the form, then shows the asset at
// /a/<id> by its catalog entry. Every element is made as text, never HTML.
const $ = (id) => document.getElementById(id);
const id = /^\/a\/([\w-]{12})$/.exec(location.pathname)?.[1];

async function signIn(token) {
  const res = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return res.ok;
}

function element(tag, attrs) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function show(asset) {
  document.title = `${asset.title ?? asset.name} · peek`;
  $("title").textContent = asset.title ?? asset.name;
  $("status").hidden = true;
  const file = new URL(asset.fileUrl).pathname;
  const kind = asset.contentType.split("/")[0];
  const media =
    kind === "image" && asset.contentType !== "image/svg+xml"
      ? element("img", { src: file, alt: asset.title ?? asset.name })
      : kind === "video"
        ? element("video", { src: file, controls: "", playsinline: "", preload: "metadata" })
        : kind === "audio"
          ? element("audio", { src: file, controls: "", preload: "metadata" })
          : Object.assign(element("a", { href: file }), { textContent: `Open ${asset.name}` });
  $("media").replaceChildren(media);
  const about = [asset.name, asset.repo && (asset.pr ? `${asset.repo}#${asset.pr}` : asset.repo), asset.task && `task ${asset.task}`, `by ${asset.createdBy}`, new Date(asset.createdAt).toLocaleString()];
  $("details").textContent = [asset.description, about.filter(Boolean).join(" · ")].filter(Boolean).join("\n");
}

async function load() {
  if (!id) {
    $("status").textContent = "peek keeps images, videos and audio, and plays them here by their link.";
    return;
  }
  const res = await fetch(`/api/assets/${id}`);
  if (res.status === 401) {
    $("status").textContent = "Sign in to see this.";
    $("signin").hidden = false;
    return;
  }
  if (!res.ok) {
    $("status").textContent = res.status === 404 ? "Nothing is here: it was deleted, or not uploaded yet." : `peek answered ${res.status}.`;
    return;
  }
  show(await res.json());
}

$("signin").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await signIn($("token").value)) {
    $("signin").hidden = true;
    await load();
  } else $("status").textContent = "That token is wrong or revoked.";
});

const fromLink = new URLSearchParams(location.hash.slice(1)).get("signin");
if (fromLink) {
  history.replaceState(null, "", location.pathname + location.search);
  await signIn(fromLink);
}
await load();
