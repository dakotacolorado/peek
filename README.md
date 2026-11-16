# peek

Keeps an agent's images, videos and audio where it made them, and serves them
back by a link that plays in the browser.

An agent uploads a screenshot, a screen recording or a sound, saying what it
is for: a repository and pull request, a waypoint task, tags. peek answers a
link to a page that shows or plays it, on a phone too, so the person reviews
it where they are instead of downloading it. Each host runs its own peek: the
files stay on its disk, with a catalog of them to search.

## Run it

Node 24 or later. To try it, with the admin token `dev`:

```sh
npm install
npm run dev
```

For real:

```sh
peek token create agents       # a token, printed once; give it to the agents' MCP config
peek serve
```

`peek backup <file>` copies the catalog while it runs. The files are the
folder `--files` names; copy it as you would any folder.

## Configure it

| Option | Environment | Default | What it does |
| --- | --- | --- | --- |
| `--host` | `PEEK_HOST` | `127.0.0.1` | Address to listen on. |
| `--port` | `PEEK_PORT` | `4810` | Port to listen on. |
| `--db` | `PEEK_DB` | `~/.local/share/peek/peek.db` | The SQLite catalog. |
| `--files` | `PEEK_FILES` | `~/.local/share/peek/files` | The folder the files live in. |
| `--public-url` | `PEEK_PUBLIC_URL` | the address each request came to | The base every `link`, `fileUrl` and `uploadUrl` is built on. |
| | `PEEK_ADMIN_TOKEN` | none | One more token, named `admin`, beside those made with `peek token`. |

`peek --help` lists the commands.

## Use it

The API reference is served at `/docs/api` (and is
[docs/API.md](docs/API.md), from [openapi.json](openapi.json)); the MCP
server's at `/docs/mcp` ([docs/MCP.md](docs/MCP.md), from
[mcp.json](mcp.json)).

Upload a file, its bytes as the body:

```sh
curl -T clip.mp4 -H "Authorization: Bearer $PEEK_TOKEN" \
  "$PEEK_URL/api/assets?name=clip.mp4&repo=owner/name&pr=12&tags=demo"
```

It answers the asset, with its `link` (the page to give the person) and its
`fileUrl` (the bytes). Find what was uploaded with
`GET /api/assets?repo=owner/name&pr=12`.

Agents use the MCP server at `/mcp`, with a token in its config:

```json
{ "mcpServers": { "peek": { "type": "http", "url": "https://peek.example.com/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

Its `upload_asset` takes a small file inline, in base64. For a larger one it
answers an upload URL and the `curl -T <file> '<uploadUrl>'` to run: that URL
needs no token, works once, and stops working after an hour.

## How it works

- **Signing in.** Every call but `/health`, `PutUpload`, the docs and the
  viewer page takes `Authorization: Bearer <token>`. A browser signs in once
  (`POST /api/session`, or opening a link that ends `#signin=<token>`), which
  sets a cookie, so images, videos and audio load in the page. A write
  signed in by the cookie alone must also send `x-peek: 1`.
- **Who uploaded it.** An asset's `createdBy` is the `x-actor` header the
  upload sent, else the token's name.
- **Playing video.** The file route answers byte ranges, which browsers need
  to play and seek a video.
- **Media types.** An upload's `Content-Type` is its type; when it sends none,
  or `application/octet-stream`, the file name's extension decides.

## Check a running peek

```sh
PEEK_URL=https://peek.example.com PEEK_TOKEN=<token> npm run integ
```

It uploads a PNG, an MP4 and an MP3, lists them, fetches a range, uploads
through the MCP server inline and by upload URL, and deletes all it made.

## Develop it

```sh
npm install
npm run typecheck
npm test
npm run build
npm run spec     # regenerates openapi.json, mcp.json and docs/
```

## License

MIT
