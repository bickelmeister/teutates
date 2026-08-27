# teutates – a Taskwarrior UI

A lightweight, localhost-optimized web interface for [Taskwarrior](https://taskwarrior.org/).

## Overview

This project provides a modern UI for managing Taskwarrior tasks. It talks to your local Taskwarrior installation through the `task` binary, so there is no database to run and no second copy of your data.

> **Note on Taskwarrior 3.x**
> Taskwarrior 3 moved task storage into a TaskChampion SQLite database, so parsing the old `.data` files is no longer viable. teutates therefore shells out to `task` (e.g. `task _show`, `task export`) and treats its output as the single source of truth.

## Tech Stack

The interface is where teutates actually understands Taskwarrior. Parsing
`task` output, resolving rc includes, applying the report's sort order and
grouping settings all happen in the browser. The server exists only to do the
two things a browser cannot: run the `task` binary and read files.

### Server
- **Runtime**: Node.js, one file, no dependencies
- **Modules**: `node:http`, `node:child_process`, `node:fs` — nothing else
- **Data access**: The `task` CLI, invoked with an argument allowlist and a timeout
- **Deployment**: `node server/teutates.mjs`, binds to `127.0.0.1` by default

### Interface
- **Markup**: Plain HTML5
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Scripting**: TypeScript, bundled with esbuild
- **Architecture**: Hash-routed views over a typed Taskwarrior client

## Project Structure

```
teutates/
├── server/
│   ├── teutates.mjs            # the whole server: exec, rc files, static UI
│   ├── dist/                   # built interface, served from disk
│   └── test/server.test.mjs    # allowlist, path guard, request guards
├── ui/
│   ├── index.html              # app shell, pre-paint theme bootstrap
│   ├── src/
│   │   ├── main.ts             # entrypoint
│   │   ├── router.ts           # hash router, one view at a time
│   │   ├── view.ts             # the contract every view implements
│   │   ├── tasks.ts            # task list view
│   │   ├── settings.ts         # settings view
│   │   ├── theme.ts            # light / dark / system
│   │   ├── format.ts           # relative dates, urgency
│   │   ├── ui.ts               # shared notice / segmented control
│   │   ├── api.ts              # what the views read; re-exports taskwarrior/
│   │   ├── input.css           # Tailwind + theme tokens
│   │   └── taskwarrior/        # everything teutates knows about Taskwarrior
│   │       ├── client.ts       # the three server calls, and their errors
│   │       ├── config.ts       # `task _show` -> effective config
│   │       ├── taskrc.ts       # ~/.taskrc + includes -> value origins
│   │       ├── tasks.ts        # `task export` -> task list
│   │       ├── sortspec.ts     # report.<name>.sort -> ordering
│   │       ├── unrecognized.ts # rc keys Taskwarrior does not know
│   │       └── service.ts      # caching, invalidated on rc mtime
│   └── test/                   # headless DOM and domain tests
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 20+ (developed against v26)
- Taskwarrior 3.x, installed and initialised

### Install and run

There is **one process**, and it has no dependencies of its own. `npm run
build` writes static files into `server/dist/`, which the server serves from
disk.

```bash
git clone <repo>
cd teutates

# 1. Build the interface once
cd ui
npm install
npm run build

# 2. Start the server (leave it in the foreground)
cd ..
node server/teutates.mjs
```

Then open <http://127.0.0.1:8080>.

### Stopping the server

**Press Ctrl+C in the terminal running it.** There is a single process and no
build step behind it, so that is all it takes.

If the terminal is gone or the server was started in the background, target the
port rather than the process tree:

```bash
lsof -ti:8080 | xargs kill
```

### What needs rebuilding

| Changed | Needed |
|---------|--------|
| `server/teutates.mjs` | Stop the server and start it again |
| `ui/**` | `npm run build`, then reload the page |

The interface is read from disk per request, so a rebuild is visible on reload
— the server does not need restarting for it. With `npm run watch:css` and
`npm run watch:js` running alongside, a saved file is on screen after a reload.
Both watchers run in the foreground and stop with Ctrl+C.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--addr` | `127.0.0.1:8080` | Listen address. teutates has no authentication — only change this if you know what you are exposing. |
| `--ui` | `server/dist` | Serve the interface from this directory instead. |

### Tests

```bash
cd ui && npm run typecheck && npm test
node --test server/test/*.test.mjs
```

The domain tests run the same code the browser runs, without a browser: they
exercise the parsers and the sort order directly. The view tests render the
real app shell in jsdom against fixtures. The server tests start the server on
an ephemeral port with a stub `task` on the PATH.

## Features

- [x] View Taskwarrior settings (read-only), grouped, searchable, with overrides marked
- [x] List tasks (read-only), ordered by `report.list.sort`, filterable by status and text
- [ ] Create new task
- [ ] Edit existing task
- [ ] Mark task as done
- [ ] Delete task
- [ ] Filter by status/project/tags
- [ ] Real-time updates

## API

Three endpoints, none of which knows what Taskwarrior output means.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/task` | Run `task` with an allowlisted argument list |
| GET | `/api/rc` | Read one rc file, resolving it the way an include resolves |
| GET | `/api/env` | Where the rc file is, when it last changed, where themes live |

### `POST /api/task`

```json
→ { "args": ["rc.verbose=nothing", "status:pending", "export"] }
← { "stdout": "[{…}]", "stderr": "", "code": 0 }
```

A non-zero exit is returned as an ordinary result rather than an error: `task
add` rejecting a date is an answer the interface should show, not a transport
failure. Only a missing binary (`503`) or a timeout (`504`) is.

**The argument list is checked before anything runs.** Taskwarrior's command
line is `task [filter] <command> [arguments]`, so the command is not simply the
first word — the first argument naming a command teutates knows is taken to be
the command, and everything around it is checked against what Taskwarrior would
still read as syntax there.

- The command must be one of `export`, `_show`, `show`, `_get`, `--version`,
  `add`, `modify`, `done`, `start`, `stop`, `delete`, `annotate`, `denotate`,
  `undo`.
- `config`, `execute`, `import`, `synchronize`, `purge`, `edit` and `context`
  are refused wherever Taskwarrior would read them as a command.
- The only accepted overrides are `rc.verbose=` and `rc.confirmation=`.
  `rc.hooks=` runs scripts and `rc.data.location=` picks a different database,
  so both are refused — as is `rc:<file>`, which would replace the rc file
  every other check is based on.

Because this endpoint writes, it is also guarded against a page elsewhere
posting to it: a JSON content type is required, so a browser must preflight the
request and no CORS headers are sent; a cross-origin `Origin` is refused; and
the `Host` header must name the loopback address the server answers on, which
is what stops DNS rebinding.

### `GET /api/rc?path=&base=`

Returns `{ "path": "…", "content": "…" }` for one rc file, resolving a relative
name against `base` first and then Taskwarrior's own rc directories — the order
an `include` directive resolves in. An include that points nowhere is a `404`,
which is a normal answer rather than a failure. Reading is confined to the home
directory, the rc file's own directory and the theme directories; `path` is
canonicalised before that is decided.

### `GET /api/env`

```json
{
  "taskrcPath": "/home/user/.taskrc",
  "taskrcMtime": 1787678356332.6,
  "home": "/home/user",
  "themeDirs": ["/opt/homebrew/share/doc/task/rc"]
}
```

`taskrcMtime` is what the interface caches its configuration against: the
configuration is re-read when the rc file changes, and served from memory
otherwise.

## What the interface computes

### Settings

Every effective setting reported by `task _show`, annotated with where the
value comes from. `source` is `default`, `taskrc`, or `include:<file>`, derived
by reading `~/.taskrc` and everything it includes. Keys that Taskwarrior does
not recognise — typos, or settings that never existed — are flagged, since
setting them has no effect; Taskwarrior reports them in a footnote of `task
show`, which is the only place that information exists.

A configured value is shown next to the effective one only when the two differ.
`color` is the common case: it falls back to `off` without a TTY, so the rc
file says `on` and Taskwarrior reports `off`.

### Tasks

The tasks from `task export`, ordered the way `task list` orders them. The
order follows `report.list.sort` from the configuration, so the interface and
the command line agree about the same data. A clause teutates cannot sort by is
named in the interface rather than silently skipped.

> **There is no global `sort` setting in Taskwarrior.** Sorting is configured
> per report (`report.<name>.sort`). A bare `sort` line in `.taskrc` is an
> unrecognized variable and has no effect — Taskwarrior itself reports it, and
> so does the settings view.

Dates are converted from Taskwarrior's `20260831T215959Z` format to RFC 3339 so
`Date` can parse them. Attributes that are not part of the standard schema are
collected as user-defined attributes, since those differ per installation and a
fixed schema would drop them.

> **`id` is not an identity.** Taskwarrior assigns short working ids to pending
> tasks only; completed tasks export as `id: 0`. Use `uuid` to identify a task.

### Errors

Every response carries the same shape on failure, including unknown routes, so
the interface always has something to show:

```json
{ "error": "Unknown API endpoint /api/nope.", "hint": "If this endpoint was added recently, restart the server …" }
```

| Status | Cause |
|--------|-------|
| `400` | Malformed body, or an argument list the allowlist refuses |
| `403` | A write from another origin, or an rc path outside the readable directories |
| `404` | Unknown route, missing static file, or an rc file that is not there |
| `405` | Known path, wrong method |
| `413` | Request body or rc file too large |
| `415` | `/api/task` reached without a JSON content type |
| `421` | A `Host` header naming something other than this server |
| `503` | `task` is not on the PATH |
| `504` | Taskwarrior did not respond within the timeout |
| `500` | Anything else |

## License

This project is **dual-licensed**:

### 🆓 GPL v3 - Free for Non-Commercial Use
Use this software freely for private, educational, and non-profit projects.
[Read the GPL v3 License](./LICENSE)

---

### Quick Reference

| Use Case | License |
|----------|---------|
| Personal project | ✅ GPL v3 |
| Open source project | ✅ GPL v3 |
| Educational use | ✅ GPL v3 |
| Paid product / SaaS | ❌ Requires Commercial License |
| Business integration | ❌ Requires Commercial License |
