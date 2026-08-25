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
│   │   └── config.go           # GET /api/config
│   ├── taskwarrior/
│   │   ├── config.go           # `task _show` -> effective config
│   │   ├── taskrc.go           # ~/.taskrc + includes -> value origins
│   │   └── service.go          # caching, invalidated on rc mtime
│   └── go.mod
├── ui/
│   ├── index.html              # app shell, pre-paint theme bootstrap
│   ├── src/
│   │   ├── main.ts             # entrypoint
│   │   ├── settings.ts         # settings view
│   │   ├── theme.ts            # light / dark / system
│   │   ├── api.ts              # typed client for /api
│   │   └── input.css           # Tailwind + theme tokens
│   ├── test/ui.test.ts         # headless DOM tests (jsdom)
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
- [ ] List all tasks
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
| GET | `/api/tasks` | Fetch all tasks *(planned)* |
| POST | `/api/tasks` | Create new task *(planned)* |
| GET | `/api/tasks/:id` | Fetch single task *(planned)* |
| PUT | `/api/tasks/:id` | Update task *(planned)* |
| DELETE | `/api/tasks/:id` | Delete task *(planned)* |

### `GET /api/config`

Returns every effective setting reported by `task _show`, annotated with where
the value comes from. `source` is `default`, `taskrc`, or `include:<file>`.
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

Errors return `{ "error": "...", "hint": "..." }` with `503` when `task` is not
on the PATH, `504` on a timeout, and `500` otherwise.

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
