---
name: test
description: How to run peek's checks. Use before submitting a change to peek, and when reviewing one.
---

# Testing peek

## The checks

An author runs these at the PR's head before submitting it, and a reviewer at
the commit reviewed. Each must exit 0. In a clean clone, with Node 24 and npm,
and the session's `*_URL`/`*_TOKEN` pairs unset so nothing reaches a deployed
service:

```sh
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN npm ci
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN npm run typecheck
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN npm test
env -u HONED_URL -u HONED_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u JOBBER_URL -u JOBBER_TOKEN -u AGENCY_URL -u AGENCY_TOKEN -u PEEK_URL -u PEEK_TOKEN npm run build
```

Run each on its own and read its exit status (`echo $?`). Never pipe one into
`tail` or `head`: the pipe reports their status, so a failure reads as a pass.

`npm test` needs no network and no service: the catalog runs on SQLite in
memory or in a temporary file, files go to temporary folders, and
`src/cli.spec.ts` starts the server on ports the OS picks. It also fails if
`openapi.json`, `mcp.json` or the docs drift from the code: regenerate them
with `npm run spec`.

Installing points git at `.githooks/`, whose pre-commit runs `npm run spec`.

## End to end

`npm run integ` checks a running instance, given its address and a token it
takes, and deletes all it made. Against a local one, on a port none holds, with
a scratch folder and token:

```sh
mkdir -p scratch && head -c 24 /dev/urandom | base64 | tr -d '/+=' > scratch/token
PEEK_ADMIN_TOKEN=$(cat scratch/token) PEEK_DB=scratch/peek.db PEEK_FILES=scratch/files node src/cli.ts serve --port 0 > scratch/log 2>&1 &
echo $! > scratch/pid   # wait until scratch/log says "listening on", and read the port there
PEEK_URL=http://127.0.0.1:<port> PEEK_TOKEN=$(cat scratch/token) npm run integ; echo $?
kill $(cat scratch/pid); rm -rf scratch
```

To see the page, `npm run dev -- --port <a free port>` (sign in with `dev`),
and stop it by the PID you started.
