# teutates – a Taskwarrior UI

A lightweight, localhost-optimized web interface for [Taskwarrior](https://taskwarrior.org/).

## Overview

This project provides a modern UI for managing Taskwarrior tasks. It talks to your local Taskwarrior installation through the `task` binary, so there is no database to run and no second copy of your data.

> **Note on Taskwarrior 3.x**
> Taskwarrior 3 moved task storage into a TaskChampion SQLite database, so parsing the old `.data` files is no longer viable. teutates therefore shells out to `task` (e.g. `task _show`, `task export`) and treats its output as the single source of truth.

## Tech Stack

### Backend
- **Language**: Go
- **Framework**: [Gin](https://gin-gonic.com/) (lightweight HTTP framework)
- **Data access**: The `task` CLI, invoked with fixed arguments and a timeout
- **Deployment**: Single binary, binds to `127.0.0.1` by default

### Frontend
- **Markup**: Plain HTML5
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Scripting**: TypeScript (or JavaScript)
- **Architecture**: Server-driven HTML with progressive enhancement

## Project Structure

```
teutates/
├── backend/
│   ├── main.go                 # Gin server, static UI, flags
│   ├── handlers/
│   │   ├── config.go           # GET /api/config
│   │   └── tasks.go            # GET /api/tasks
│   ├── taskwarrior/
│   │   ├── config.go           # `task _show` -> effective config
│   │   ├── taskrc.go           # ~/.taskrc + includes -> value origins
│   │   ├── tasks.go            # `task export` -> task list
│   │   ├── sortspec.go         # report.<name>.sort -> ordering
│   │   ├── unrecognized.go     # rc keys Taskwarrior does not know
│   │   ├── decode.go           # tolerant decoding of export fields
│   │   └── service.go          # caching, invalidated on rc mtime
│   └── go.mod
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
│   │   ├── api.ts              # typed client for /api
│   │   └── input.css           # Tailwind + theme tokens
│   ├── test/                   # headless DOM tests (jsdom)
│   └── assets/                 # build output, not committed
└── README.md
```

## Getting Started

### Prerequisites
- Go 1.21+
- Node.js 18+ (for Tailwind CSS)
- Taskwarrior installed and initialized

### Installation

```bash
git clone <repo>
cd teutates

# 1. Build the UI (the server serves ui/assets/)
cd ui
npm install
npm run build

# 2. Run the server
cd ../backend
go run .

# Open http://127.0.0.1:8080
```

During development, `npm run watch:css` and `npm run watch:js` rebuild on change.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-addr` | `127.0.0.1:8080` | Listen address. teutates has no authentication — only change this if you know what you are exposing. |
| `-ui` | `../ui` | Directory containing `index.html` and `assets/`. |

### Tests

```bash
cd backend && go test ./...
cd ui && npm run typecheck && npm test
```

## Features

- [x] View Taskwarrior settings (read-only), grouped, searchable, with overrides marked
- [x] List tasks (read-only), ordered by `report.list.sort`, filterable by status and text
- [ ] Create new task
- [ ] Edit existing task
- [ ] Mark task as done
- [ ] Delete task
- [ ] Filter by status/project/tags
- [ ] Real-time updates

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/config` | Effective Taskwarrior configuration with value origins |
| GET | `/api/tasks` | List tasks, filtered by status |
| POST | `/api/tasks` | Create new task *(planned)* |
| GET | `/api/tasks/:id` | Fetch single task *(planned)* |
| PUT | `/api/tasks/:id` | Update task *(planned)* |
| DELETE | `/api/tasks/:id` | Delete task *(planned)* |

### `GET /api/config`

Returns every effective setting reported by `task _show`, annotated with where
the value comes from. `source` is `default`, `taskrc`, or `include:<file>`.
Keys that Taskwarrior does not recognise — typos, or settings that never
existed — are flagged with `unrecognized` and collected in `unrecognizedKeys`,
since setting them has no effect.
`configuredValue` appears only when the rc file states something different from
what Taskwarrior resolves at runtime — `color` is the common case, since it
falls back to `off` without a TTY.

```json
{
  "taskVersion": "3.5.0",
  "taskrcPath": "/home/user/.taskrc",
  "groups": [{ "name": "general", "count": 25 }],
  "settings": [
    {
      "key": "color",
      "value": "off",
      "configuredValue": "on",
      "group": "general",
      "source": "taskrc",
      "isOverride": true
    }
  ]
}
```

### `GET /api/tasks`

Returns the tasks from `task export`, ordered the way `task list` orders them.
`status` selects the set and accepts only `pending` (the default), `completed`,
or `all`; anything else is rejected with `400` and never reaches the command
line.

The order follows `report.list.sort` from the configuration, so the interface
and the command line agree about the same data. The applied specification is
echoed back under `sort`, together with any clause teutates cannot sort by.

> **There is no global `sort` setting in Taskwarrior.** Sorting is configured
> per report (`report.<name>.sort`). A bare `sort` line in `.taskrc` is an
> unrecognized variable and has no effect — Taskwarrior itself reports it, and
> so does the settings view.

Dates are converted from Taskwarrior's `20260831T215959Z` format to RFC 3339 so
the browser can parse them. Attributes that are not part of the standard schema
are collected under `udas`, since user-defined attributes differ per
installation and a fixed schema would drop them.

```json
{
  "status": "pending",
  "counts": { "total": 28, "pending": 28, "active": 2, "overdue": 4 },
  "udaLabels": { "pom": "Pomodoris" },
  "tasks": [
    {
      "id": 19,
      "uuid": "46df3135-ff84-496a-891c-b1bf79991a67",
      "description": "Flaschenvertrag fertigstellen",
      "status": "pending",
      "tags": ["privat"],
      "priority": "H",
      "urgency": 24.4096,
      "due": "2026-08-23T21:59:59Z",
      "udas": { "pom": "1" }
    }
  ],
  "sort": { "report": "list", "spec": "start-,due+,project+,urgency-" }
}
```

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
| `400` | Invalid parameter, e.g. an unsupported `status` value |
| `404` | Unknown route or missing static file |
| `405` | Known path, wrong method — teutates is read-only and answers `GET` |
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
