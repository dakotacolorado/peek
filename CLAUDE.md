# peek

Keeps an agent's images, videos and audio where it made them, and serves them
back by a link that plays in the browser. An asset is a file plus one catalog
row (name, media type, size, sha256, title, description, repo, pr, task, tags,
creator). Keep the model this simple: assets, tokens, browser sessions and
upload tickets, nothing of any one caller's domain. One Node 24 process
(`src/cli.ts`) per host serving HTTP, the catalog in one SQLite file
(`src/store.ts`), the bytes in a folder (`src/files.ts`). Nothing is proxied
to another host.

Keep it fact-dense: the code carries the facts. Prefer a mechanism to a
comment: a type, a test or a thrown error cannot rot. Comment only for a limit
a reader would otherwise violate, a deliberate choice that reads as a mistake,
or platform behaviour not visible in the source.

The repository is public: no hosts, addresses, tokens or deployment details
of any one setup in it.

## Contract

`src/schema.ts` is the source of `openapi.json`, its AWS-layout reference
(`docs/API.md`, by `src/api-doc.ts`) and Redoc's page of it
(`docs/index.html`, served at `/docs/api`). `src/mcp.ts`, whose tools mirror
the asset operations, is the source of `mcp.json`, `docs/MCP.md` and
`docs/mcp.html`. The pre-commit hook regenerates all of them
(`npm run spec`); a test fails if any drifts.

Name an operation VerbNoun as AWS does, keep summaries to two or three
words, describe every field, and answer errors as `{code, message}` with the
status's exception name (`ERROR_CODES`): tests hold all of it.

## Rules a change must keep

- **Bytes stream.** An upload is piped from the request to disk
  (`DiskFiles.write`), never buffered: several-GB videos are the point. Never
  `arrayBuffer()`, `text()` or `json()` an upload body.
- **A row always has its file.** Bytes are written whole (under
  `<files>/.uploads/`, then renamed) before the row; the row is deleted
  before the bytes.
- **Secrets are hashes.** Tokens, sessions and upload tickets are stored as
  sha256. A long-lived token never goes in a URL; the upload ticket, single-use
  and an hour long, is the one secret that does.
- **Files run nothing.** `/f/` answers with `nosniff` and a `sandbox` CSP, so an
  uploaded HTML or SVG cannot act on peek's origin with the session cookie.
- **The cookie is for browsers.** It is HttpOnly, Secure, SameSite=Lax; a write
  signed in by it alone needs `x-peek: 1`; `/mcp` never takes it.
- **The page holds no data.** `ui/` is a shell, the same for every asset,
  served without a token; it fetches the asset signed in and makes every
  element as text, never HTML. Tap targets at least 44 pixels.

## Where things are

- `src/domain.ts`: types and pure rules: names, media types (`contentTypeOf`), byte ranges (`rangeOf`), limits.
- `src/service.ts`: `Peek`: put (file, then row), update, delete (row, then file), upload tickets.
- `src/files.ts`: `Files`, the bytes by id and name, and `DiskFiles`. Another backend is another class.
- `src/store.ts`: SQLite. A new shape is a new entry appended to `MIGRATIONS`, never an edit to one.
- `src/banner.ts`: the tagline, summary, block letters and eye mark: the terminal banner, the page's header, landing and favicon all take them from here.
- `src/api.ts`: routes, auth, the file route's ranges, `/mcp` (stateless, each tool one in-process API request with the caller's own headers).
- `src/integ.ts`: `npm run integ`, end to end against a running instance; not part of `npm test`.

## Tests

Colocated as `*.spec.ts`; test our rules, not the library's. `npm test` needs
no network: the catalog runs on SQLite in memory or in a temporary file, files
go to a temporary folder (`src/testing.ts`), and `src/cli.spec.ts` starts the
server on ports the OS picks. How to run the checks is the `test` skill
(`.claude/skills/test/SKILL.md`).
