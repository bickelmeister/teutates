# teutates – a Taskwarrior UI

A lightweight, localhost-optimized web interface for [Taskwarrior](https://taskwarrior.org/).

## Overview

This project provides a modern UI for managing Taskwarrior tasks. The application reads and writes directly to your local Taskwarrior data files without requiring a database or complex backend infrastructure.

## Tech Stack

### Backend
- **Language**: Go
- **Framework**: [Gin](https://gin-gonic.com/) (lightweight HTTP framework)
- **File I/O**: Direct access to Taskwarrior data files
- **Deployment**: Single binary, no external dependencies

### Frontend
- **Markup**: Plain HTML5
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Scripting**: TypeScript (or JavaScript)
- **Architecture**: Server-driven HTML with progressive enhancement

## Project Structure

```
taskwarrior-ui/
├── backend/
│   ├── main.go
│   ├── handlers/
│   ├── taskwarrior/
│   └── go.mod
├── ui/
│   ├── index.html
│   ├── styles.css (compiled Tailwind)
│   ├── script.ts (or .js)
│   └── tsconfig.json (optional)
└── README.md
```

## Getting Started

### Prerequisites
- Go 1.21+
- Node.js 18+ (for Tailwind CSS)
- Taskwarrior installed and initialized

### Installation

```bash
# Clone repository
git clone <repo>
cd taskwarrior-ui

# Backend setup
cd backend
go mod download
go run main.go

# UI setup (in another terminal)
cd ui
npm install
npm run build  # Build Tailwind CSS

# Open browser
# http://localhost:8080
```

## Features (Planned)

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
| GET | `/api/tasks` | Fetch all tasks |
| POST | `/api/tasks` | Create new task |
| GET | `/api/tasks/:id` | Fetch single task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |

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
