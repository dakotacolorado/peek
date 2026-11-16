# peek API reference

API version 2026-11-15

Keeps an agent's images, videos and audio where it made them, and serves them back by a link that plays in the browser. **Agents** upload a file they made, a screenshot, a screen recording or a sound, saying what it is for (a repository and pull request, a waypoint task, tags), and give **the person** its `link`, which shows or plays it in their browser, on a phone too. Each host runs its own peek: the files stay on the disk where they were made, with a catalog of them to search.

- **Upload** with `PutAsset`: the file's bytes are the request body, streamed to disk, so a several-GB video works. An agent with only the MCP server asks for an upload URL instead (`CreateUploadUrl`), and runs the `curl` it answers: the file never passes through the model, and the command needs no token.
- **Find** with `ListAssets`, by repository, pull request, task, tags, media type, uploader or text, newest first.
- **Serve:** an asset's `fileUrl` (`GetFile`) answers byte ranges, so a browser seeks a video; its `link` is the page that shows it.
- **Change** what an asset is of with `UpdateAsset`, and remove it, file and all, with `DeleteAsset`.

**Auth:** `Authorization: Bearer <token>` on everything but `GetHealth`, `PutUpload` (whose URL is its own single-use ticket), the docs and the page. Each token has a name, made with `peek token create <name>`; `PEEK_ADMIN_TOKEN` is one more, named `admin`. Every token may do everything. A browser signs in once with `CreateSession`, which sets a cookie that every call then takes, so `<img>`, `<video>` and `<audio>` load; a write signed in by the cookie alone must also send `x-peek: 1`, or is refused 403.

**Uploader:** an asset's `createdBy` is the uploader's `x-actor` header, when it gives one, else its token's name.

**Errors:** `{code, message}`, where `code` is an AWS-style exception name such as `ValidationException` or `ResourceNotFoundException`.

## Operations

- [CreateSession](#createsession): Create a session
- [CreateUploadUrl](#createuploadurl): Create upload URL
- [DeleteAsset](#deleteasset): Delete an asset
- [DeleteSession](#deletesession): Delete a session
- [GetAsset](#getasset): Get an asset
- [GetFile](#getfile): Get a file
- [GetHealth](#gethealth): Get health
- [ListAssets](#listassets): List assets
- [PutAsset](#putasset): Put an asset
- [PutUpload](#putupload): Put an upload
- [UpdateAsset](#updateasset): Update an asset

## Data types

- [Asset](#asset)
- [Error](#error)
- [Health](#health)
- [Session](#session)

---

## CreateSession

Signs a browser in: sets the `peek_session` cookie (HttpOnly, Secure, SameSite=Lax), which every other call then takes in place of the bearer token, for 30 days or until the token is revoked. A write signed in by the cookie alone must also send `x-peek: 1`.

### Request syntax

```http
POST /api/session HTTP/1.1
Authorization: Bearer token
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "name": "string",
   "expiresAt": "string"
}
```

### Response elements

**name**  
Whose it is: the token's name.  
Type: String.

**expiresAt**  
When it ends (ISO 8601).  
Type: String.

### Errors

**UnauthorizedException**  
The bearer token is missing, wrong or revoked.  
HTTP status: 401

---

## CreateUploadUrl

Makes a URL that uploads one file, by these details, with no token: `curl -T <file> '<uploadUrl>'`. It works once, within the hour; the asset's id, and so its `link`, are fixed now and answer 404 until it is used. For an agent with a token in its MCP server's config only, so the file never passes through it.

### Request syntax

```http
POST /api/uploads HTTP/1.1
Authorization: Bearer token
Content-type: application/json

{
   "name": "string",
   "contentType": "string",
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ]
}
```

### Request body

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`. Required: Yes.

**contentType**  
Its media type, such as `video/mp4`. Default: the name's extension's.  
Type: String. Length: 0 to 200. Required: No.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Required: No.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Required: No.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Required: No.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Required: No.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Required: No.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items. Required: No.

### Response syntax

```http
HTTP/1.1 201
Content-type: application/json

{
   "id": "string",
   "link": "string",
   "uploadUrl": "string",
   "curl": "string",
   "expiresAt": "string"
}
```

### Response elements

**id**  
The asset's id, once uploaded.  
Type: String. Pattern: `^[\w-]{12}$`.

**link**  
The asset's page, once uploaded.  
Type: String.

**uploadUrl**  
PUT the file's bytes here, with no token, once.  
Type: String.

**curl**  
The command that uploads it, for `<file>` the file's path.  
Type: String.

**expiresAt**  
When `uploadUrl` stops working, if not used (ISO 8601).  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## DeleteAsset

Removes the asset from the catalog, then its file. Its link and file URL answer 404 after.

### Request syntax

```http
DELETE /api/assets/{id} HTTP/1.1
Authorization: Bearer token
```

### URI request parameters

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`. Required: Yes.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "id": "string",
   "name": "string",
   "contentType": "string",
   "size": number,
   "sha256": "string",
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ],
   "createdBy": "string",
   "createdAt": "string",
   "link": "string",
   "fileUrl": "string"
}
```

### Response elements

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`.

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`.

**contentType**  
Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's.  
Type: String. Length: 0 to 200.

**size**  
Its size in bytes.  
Type: Integer. Range: 1 to any.

**sha256**  
Its SHA-256, in hex.  
Type: String.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Nullable: Yes.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Nullable: Yes.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Nullable: Yes.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items.

**createdBy**  
Who uploaded it: the uploader's `x-actor` header, else its token's name.  
Type: String.

**createdAt**  
Uploaded at (ISO 8601).  
Type: String.

**link**  
Its page, which shows or plays it in the browser: the link to give the person.  
Type: String.

**fileUrl**  
Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token.  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**ResourceNotFoundException**  
No asset has that id.  
HTTP status: 404

---

## DeleteSession

Signs the browser out: ends its session and clears the cookie.

### Request syntax

```http
DELETE /api/session HTTP/1.1
Authorization: Bearer token
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "ok": "true"
}
```

### Response elements

**ok**  
Always true.  
Type: Boolean.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## GetAsset

Get an asset.

### Request syntax

```http
GET /api/assets/{id} HTTP/1.1
Authorization: Bearer token
```

### URI request parameters

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`. Required: Yes.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "id": "string",
   "name": "string",
   "contentType": "string",
   "size": number,
   "sha256": "string",
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ],
   "createdBy": "string",
   "createdAt": "string",
   "link": "string",
   "fileUrl": "string"
}
```

### Response elements

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`.

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`.

**contentType**  
Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's.  
Type: String. Length: 0 to 200.

**size**  
Its size in bytes.  
Type: Integer. Range: 1 to any.

**sha256**  
Its SHA-256, in hex.  
Type: String.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Nullable: Yes.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Nullable: Yes.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Nullable: Yes.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items.

**createdBy**  
Who uploaded it: the uploader's `x-actor` header, else its token's name.  
Type: String.

**createdAt**  
Uploaded at (ISO 8601).  
Type: String.

**link**  
Its page, which shows or plays it in the browser: the link to give the person.  
Type: String.

**fileUrl**  
Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token.  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**ResourceNotFoundException**  
No asset has that id.  
HTTP status: 404

---

## GetFile

An asset's bytes, as its `fileUrl` gives them, with its media type, `Accept-Ranges: bytes` and an `ETag` of its SHA-256. A `Range` of one span (`bytes=0-1023`, `bytes=1024-`, `bytes=-1024`) answers 206 with just those bytes, so a browser plays and seeks a video. `<img>`, `<video>` and `<audio>` load it once the browser is signed in (`CreateSession`).

### Request syntax

```http
GET /f/{id}/{name} HTTP/1.1
Authorization: Bearer token
range: string
```

### URI request parameters

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`. Required: Yes.

**name**  
The asset's name, URL-encoded.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`. Required: Yes.

### Request headers

**range**  
One span of bytes, such as `bytes=0-1023`.  
Type: String. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: */*

The whole file.
```

### Response elements

The whole file. As `*/*`.

### Errors

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**ResourceNotFoundException**  
No asset has that id.  
HTTP status: 404

**RangeNotSatisfiableException**  
The range starts past the end of the file.  
HTTP status: 416

---

## GetHealth

Get health.

### Request syntax

```http
GET /health HTTP/1.1
```

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "ok": "true",
   "version": "string",
   "commit": "string"
}
```

### Response elements

**ok**  
Always true.  
Type: Boolean.

**version**  
Package version.  
Type: String.

**commit**  
Commit it was built from.  
Type: String.

---

## ListAssets

Assets matching every filter given, newest first, a page at a time: while `nextToken` is not null, pass it for the next page.

### Request syntax

```http
GET /api/assets?repo=repo&pr=pr&task=task&tags=tags&contentType=contentType&createdBy=createdBy&q=q&maxResults=maxResults&nextToken=nextToken HTTP/1.1
Authorization: Bearer token
```

### Query parameters

**repo**  
Only those for this repository.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Required: No.

**pr**  
Only those for this pull request.  
Type: Number. Required: No.

**task**  
Only those for this waypoint task.  
Type: String. Pattern: `^[\w-]{1,64}$`. Required: No.

**tags**  
Only those carrying every one of these tags, comma-separated.  
Type: String. Length: 0 to 1300. Required: No.

**contentType**  
Only those whose media type starts with this, such as `video/` or `image/png`.  
Type: String. Length: 0 to 200. Required: No.

**createdBy**  
Only those uploaded by this caller.  
Type: String. Length: 0 to 100. Required: No.

**q**  
Only those whose name, title or description holds this text, ignoring case.  
Type: String. Length: 1 to 200. Required: No.

**maxResults**  
The most to answer. Default: 50.  
Type: Integer. Range: 1 to 200. Required: No.

**nextToken**  
The `nextToken` a page answered, for the page after it.  
Type: String. Length: 0 to 500. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "assets": [ {
      "id": "string",
      "name": "string",
      "contentType": "string",
      "size": number,
      "sha256": "string",
      "title": "string",
      "description": "string",
      "repo": "string",
      "pr": number,
      "task": "string",
      "tags": [ "string" ],
      "createdBy": "string",
      "createdAt": "string",
      "link": "string",
      "fileUrl": "string"
   } ],
   "nextToken": "string"
}
```

### Response elements

**assets**  
This page's assets, newest first.  
Type: Array of [Asset](#asset) objects.

**nextToken**  
Pass it as `nextToken` for the next page; null on the last.  
Type: String. Nullable: Yes.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## PutAsset

Uploads a file: its bytes are the body, streamed to disk, so a file of any size can be sent; what it is of goes in the query. The `Content-Type` header gives its media type; without one, or with `application/octet-stream`, its name's extension does. Answers the asset with its `link`. For example, `curl -T clip.mp4 -H "Authorization: Bearer $PEEK_TOKEN" "$PEEK_URL/api/assets?name=clip.mp4&repo=owner/name&pr=12"`.

### Request syntax

```http
PUT /api/assets?name=name&title=title&description=description&repo=repo&pr=pr&task=task&tags=tags HTTP/1.1
Authorization: Bearer token
Content-type: application/octet-stream

The file's bytes
```

### Query parameters

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`. Required: Yes.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Required: No.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Required: No.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Required: No.

**pr**  
The pull request it is for, in `repo`.  
Type: Number. Required: No.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Required: No.

**tags**  
Tags, comma-separated.  
Type: String. Length: 0 to 1300. Required: No.

### Request body

The file's bytes, as `application/octet-stream`.

### Response syntax

```http
HTTP/1.1 201
Content-type: application/json

{
   "id": "string",
   "name": "string",
   "contentType": "string",
   "size": number,
   "sha256": "string",
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ],
   "createdBy": "string",
   "createdAt": "string",
   "link": "string",
   "fileUrl": "string"
}
```

### Response elements

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`.

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`.

**contentType**  
Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's.  
Type: String. Length: 0 to 200.

**size**  
Its size in bytes.  
Type: Integer. Range: 1 to any.

**sha256**  
Its SHA-256, in hex.  
Type: String.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Nullable: Yes.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Nullable: Yes.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Nullable: Yes.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items.

**createdBy**  
Who uploaded it: the uploader's `x-actor` header, else its token's name.  
Type: String.

**createdAt**  
Uploaded at (ISO 8601).  
Type: String.

**link**  
Its page, which shows or plays it in the browser: the link to give the person.  
Type: String.

**fileUrl**  
Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token.  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

---

## PutUpload

Uploads the file an upload URL was made for: as `PutAsset`, but with no token, and the details given when the URL was made. The URL is spent by the first try, even one that fails; ask for another after that.

### Request syntax

```http
PUT /api/uploads/{ticket} HTTP/1.1
Content-type: application/octet-stream

The file's bytes
```

### URI request parameters

**ticket**  
The upload ticket, as `CreateUploadUrl` gave it in `uploadUrl`.  
Type: String. Pattern: `^[\w-]{32}$`. Required: Yes.

### Request body

The file's bytes, as `application/octet-stream`.

### Response syntax

```http
HTTP/1.1 201
Content-type: application/json

{
   "id": "string",
   "name": "string",
   "contentType": "string",
   "size": number,
   "sha256": "string",
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ],
   "createdBy": "string",
   "createdAt": "string",
   "link": "string",
   "fileUrl": "string"
}
```

### Response elements

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`.

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`.

**contentType**  
Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's.  
Type: String. Length: 0 to 200.

**size**  
Its size in bytes.  
Type: Integer. Range: 1 to any.

**sha256**  
Its SHA-256, in hex.  
Type: String.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Nullable: Yes.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Nullable: Yes.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Nullable: Yes.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items.

**createdBy**  
Who uploaded it: the uploader's `x-actor` header, else its token's name.  
Type: String.

**createdAt**  
Uploaded at (ISO 8601).  
Type: String.

**link**  
Its page, which shows or plays it in the browser: the link to give the person.  
Type: String.

**fileUrl**  
Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token.  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**AccessDeniedException**  
The upload URL is wrong, already used or expired.  
HTTP status: 403

---

## UpdateAsset

Sets what an asset is of: the fields given, leaving the rest. Its bytes and name do not change.

### Request syntax

```http
PATCH /api/assets/{id} HTTP/1.1
Authorization: Bearer token
Content-type: application/json

{
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ]
}
```

### URI request parameters

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`. Required: Yes.

### Request body

**title**  
What it shows, in a few words; null clears it.  
Type: String. Length: 1 to 200. Nullable: Yes. Required: No.

**description**  
More on what it shows; null clears it.  
Type: String. Length: 1 to 4000. Nullable: Yes. Required: No.

**repo**  
The repository it is for, as `owner/name`; null clears it.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes. Required: No.

**pr**  
The pull request it is for; null clears it.  
Type: Integer. Range: 1 to any. Nullable: Yes. Required: No.

**task**  
The waypoint task it is for; null clears it.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes. Required: No.

**tags**  
Its tags, replacing those it had.  
Type: Array of strings. At most 20 items. Required: No.

### Response syntax

```http
HTTP/1.1 200
Content-type: application/json

{
   "id": "string",
   "name": "string",
   "contentType": "string",
   "size": number,
   "sha256": "string",
   "title": "string",
   "description": "string",
   "repo": "string",
   "pr": number,
   "task": "string",
   "tags": [ "string" ],
   "createdBy": "string",
   "createdAt": "string",
   "link": "string",
   "fileUrl": "string"
}
```

### Response elements

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`.

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`.

**contentType**  
Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's.  
Type: String. Length: 0 to 200.

**size**  
Its size in bytes.  
Type: Integer. Range: 1 to any.

**sha256**  
Its SHA-256, in hex.  
Type: String.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Nullable: Yes.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Nullable: Yes.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Nullable: Yes.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items.

**createdBy**  
Who uploaded it: the uploader's `x-actor` header, else its token's name.  
Type: String.

**createdAt**  
Uploaded at (ISO 8601).  
Type: String.

**link**  
Its page, which shows or plays it in the browser: the link to give the person.  
Type: String.

**fileUrl**  
Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token.  
Type: String.

### Errors

**ValidationException**  
The request failed validation.  
HTTP status: 400

**UnauthorizedException**  
No bearer token or session, or it is wrong, revoked or expired.  
HTTP status: 401

**ResourceNotFoundException**  
No asset has that id.  
HTTP status: 404

---

# Data types

## Asset

A file peek keeps, and what it is of.

### Contents

**id**  
The asset's id: 12 URL-safe characters.  
Type: String. Pattern: `^[\w-]{12}$`. Required: Yes.

**name**  
The file's name, with its extension: no path.  
Type: String. Length: 1 to 200. Pattern: `^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$`. Required: Yes.

**contentType**  
Its media type: the upload's `Content-Type`, or, when that says nothing (`application/octet-stream`), the name's extension's.  
Type: String. Length: 0 to 200. Required: Yes.

**size**  
Its size in bytes.  
Type: Integer. Range: 1 to any. Required: Yes.

**sha256**  
Its SHA-256, in hex.  
Type: String. Required: Yes.

**title**  
What it shows, in a few words.  
Type: String. Length: 1 to 200. Nullable: Yes. Required: Yes.

**description**  
More on what it shows, or what to look for.  
Type: String. Length: 1 to 4000. Nullable: Yes. Required: Yes.

**repo**  
The GitHub repository it is for, as `owner/name`.  
Type: String. Pattern: `^[\w.-]+\/[\w.-]+$`. Nullable: Yes. Required: Yes.

**pr**  
The pull request it is for, in `repo`.  
Type: Integer. Range: 1 to any. Nullable: Yes. Required: Yes.

**task**  
The waypoint task it is for, by its short id.  
Type: String. Pattern: `^[\w-]{1,64}$`. Nullable: Yes. Required: Yes.

**tags**  
Tags, at most 20.  
Type: Array of strings. At most 20 items. Required: Yes.

**createdBy**  
Who uploaded it: the uploader's `x-actor` header, else its token's name.  
Type: String. Required: Yes.

**createdAt**  
Uploaded at (ISO 8601).  
Type: String. Required: Yes.

**link**  
Its page, which shows or plays it in the browser: the link to give the person.  
Type: String. Required: Yes.

**fileUrl**  
Its bytes, served with range support. A browser reaches it once signed in (`CreateSession`); anything else with a bearer token.  
Type: String. Required: Yes.

## Error

Every error's body.

### Contents

**code**  
Exception name.  
Type: String. Valid values: `ValidationException` | `UnauthorizedException` | `AccessDeniedException` | `ResourceNotFoundException` | `ConflictException` | `RangeNotSatisfiableException` | `InternalServerException`. Required: Yes.

**message**  
What went wrong.  
Type: String. Required: Yes.

## Health

### Contents

**ok**  
Always true.  
Type: Boolean. Required: Yes.

**version**  
Package version.  
Type: String. Required: Yes.

**commit**  
Commit it was built from.  
Type: String. Required: Yes.

## Session

A browser's sign-in.

### Contents

**name**  
Whose it is: the token's name.  
Type: String. Required: Yes.

**expiresAt**  
When it ends (ISO 8601).  
Type: String. Required: Yes.

