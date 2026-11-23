# peek's MCP server

<!-- Generated from src/mcp.ts by `npm run spec`; do not edit. -->

peek keeps the images, videos, audio, text and markdown an agent makes on its host, and serves each back by a link that plays or shows it in the person's browser (text and markdown up to 1 MB). Its MCP server is for agents: upload a file, small ones inline and large ones by a single-use upload URL that `curl` sends from the shell, and give the person its link; find, change and delete what was uploaded. It is served at `/mcp` (streamable HTTP, stateless, answering JSON), under a token from `peek token create <name>`; each tool is one API request made with it, so it is refused and answered as that request would be. A refusal comes back as the tool's error, in the API's words.

```json
{
  "mcpServers": {
    "peek": {
      "type": "http",
      "url": "https://peek.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <your token>"
      }
    }
  }
}
```

## Instructions

What the server tells an agent when it connects:

> peek: See what your agents made, wherever you are. It keeps the images, videos, audio, text and markdown you make, on this host, and gives each a link that shows or plays it in the person's browser, on their phone too. Upload a screenshot, a screen recording, a sound or a report you want the person to see or hear or read: a `.md` report gets a link that shows it formatted, a `.txt`, `.csv` or `.json` file one that shows it as text (up to 1 MB; larger text offers a download), and give them its link (in a PR, a task comment or a message) instead of attaching the file.
>
> - upload_asset takes the file's name and what it is for: repo (owner/name) and pr, task (a waypoint short id), title, tags. Give content (the file in base64) only for a small file, up to a few MB. For anything larger, give no content: it answers an uploadUrl and the exact curl command to run in your shell, which needs no token and works once, within the hour. Either way it answers the asset's link.
> - Give the person link, never fileUrl: link is the page that plays it.
> - list_assets finds what was uploaded, newest first, by repo, pr, task, tags, contentType prefix (video/), createdBy or text in q; pass nextToken for the next page.
> - update_asset changes what an asset is of; delete_asset removes it and its file.
> - Every tool takes the token this server was connected with.

## Tools

| Tool | Does | Reads only |
| --- | --- | --- |
| [`upload_asset`](#upload_asset) | Upload an asset |  |
| [`list_assets`](#list_assets) | List assets | yes |
| [`get_asset`](#get_asset) | Get an asset | yes |
| [`update_asset`](#update_asset) | Update an asset |  |
| [`delete_asset`](#delete_asset) | Delete an asset |  |

### upload_asset

Keeps a file and answers its `link`, the page that shows or plays it, to give the person (a `.md` file shows formatted, other text as text, up to 1 MB). With `content` (base64, for a small file) it is stored now and the asset answered. Without it, answers an `uploadUrl` and the `curl` command that uploads the file from your shell: run it with `<file>` replaced by the file's path. It needs no token, works once within the hour, and answers the asset; the `link` answered now works once it has run.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `path` | string |  | Refused: peek takes no path. Send the file's bytes, or ask for an upload URL. |
| `name` | string | yes | The file's name, with its extension: no path. |
| `contentType` | string |  | Its media type, such as `video/mp4`. Default: the name's extension's. |
| `title` | string |  | What it shows, in a few words. |
| `description` | string |  | More on what it shows, or what to look for. |
| `repo` | string |  | The GitHub repository it is for, as `owner/name`. |
| `pr` | integer |  | The pull request it is for, in `repo`. |
| `task` | string |  | The waypoint task it is for, by its short id. |
| `tags` | string[] |  | Tags, at most 20. |
| `content` | string |  | The file, in base64, for a small one (at most 16,000,000 characters, about 12 MB). Leave it out to be given an uploadUrl and a curl command that uploads the file from your shell instead. |

### list_assets

Assets matching every filter given, newest first, a page at a time: while `nextToken` is not null, pass it for the next page.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `repo` | string |  | Only those for this repository. |
| `pr` | number |  | Only those for this pull request. |
| `task` | string |  | Only those for this waypoint task. |
| `tags` | string[] |  | Only those carrying every one of these tags. |
| `contentType` | string |  | Only those whose media type starts with this, such as `video/` or `image/png`. |
| `createdBy` | string |  | Only those uploaded by this caller. |
| `q` | string |  | Only those whose name, title or description holds this text, ignoring case. |
| `maxResults` | integer |  | The most to answer. Default: 50. |
| `nextToken` | string |  | The `nextToken` a page answered, for the page after it. |

### get_asset

An asset, with its `link` and `fileUrl`.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `id` | string | yes | The asset's id: 12 URL-safe characters. |

### update_asset

Sets what an asset is of: the fields given, leaving the rest. Its bytes and name do not change.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `id` | string | yes | The asset's id: 12 URL-safe characters. |
| `title` | string or null |  | What it shows, in a few words; null clears it. |
| `description` | string or null |  | More on what it shows; null clears it. |
| `repo` | string or null |  | The repository it is for, as `owner/name`; null clears it. |
| `pr` | integer or null |  | The pull request it is for; null clears it. |
| `task` | string or null |  | The waypoint task it is for; null clears it. |
| `tags` | string[] |  | Its tags, replacing those it had. |

### delete_asset

Removes the asset from the catalog, then its file. Its link and file URL answer 404 after.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `id` | string | yes | The asset's id: 12 URL-safe characters. |
