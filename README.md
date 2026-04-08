# Task Workflow Enhancer

> A powerful task management plugin for Obsidian with inbox, triage, project views, subtasks, weekly reports, and archive workflows.

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-1.5.0+-blueviolet)](https://obsidian.md)
[![GitHub Release](https://img.shields.io/github/v/release/shawnshaw/task-workflow-enhancer-plugin)](https://github.com/shawnshaw/task-workflow-enhancer-plugin/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Features

### Task Workspace
Three-panel layout with sidebar, task list, and detail panel. Switch between Today / Tomorrow / Weekly views.

### Inbox Triage
Capture tasks quickly, then triage them using four workflow tags:

| Tag | Meaning |
|-----|---------|
| `#daily` | Repeats every day |
| `#weekly` | Repeats every week |
| `#WAIT` | Waiting for confirmation |
| `#BLOCKED` | Blocked by external dependency |

### Complexity Estimation
Estimate task complexity with `#C1` through `#C5` tags to prioritize your backlog.

### Project Tracking
Aggregate all tasks tagged with `#P/<project-name>` across your vault into a unified project view with risk indicators and blocking status.

### Subtasks
Expand any task to manage sub-tasks with their own time ranges, dates, and workflow tags. Subtasks sync to a nested `## Tasks` block in the task note.

### Weekly Reports
Generate structured weekly summaries automatically:

- Completed tasks
- In-progress tasks
- Waiting / blocked tasks
- Tasks completed this week
- Next week's plan

### Archive Workflows
Two archive modes: **Knowledge Archive** (for completed tasks with reusable insights) and **Evidence Archive** (for work痕迹). Monthly archived files are auto-compacted.

### Inline Editor Actions
Hover over any task line to reveal quick-action buttons for time range, triage, date, and project tag — without leaving your current note.

---

## Installation

### Manual (Recommended for self-hosted)
1. Download the latest release from the [Releases page](https://github.com/shawnshaw/task-workflow-enhancer-plugin/releases)
2. Copy `manifest.json`, `main.js`, and `styles.css` to your vault's `.obsidian/plugins/task-workflow-enhancer/` directory
3. Enable the plugin in Obsidian Settings → Community Plugins

### BRAT Plugin
1. Install the **BRAT** community plugin
2. Add repository: `https://github.com/shawnshaw/task-workflow-enhancer-plugin`
3. Enable auto-update and install

### From Source
```bash
git clone https://github.com/shawnshaw/task-workflow-enhancer-plugin.git
cd task-workflow-enhancer-plugin
npm install
npm run build   # produces main.js + styles.css
```
Copy the output files to your vault's plugin directory.

---

## Usage

### Commands (Ctrl/Cmd+P)

| Command | Description |
|---------|-------------|
| `任务：打开任务工作台` | Open the full task workspace panel |
| `任务：打开 Project 面板` | Open the project aggregation panel |
| `任务：插入时间段` | Insert a time range on the current task line |
| `任务：分拣当前任务` | Assign a workflow tag to the current task |
| `任务：设置日期` | Set scheduled/due date for the current task |
| `任务：设置项目标签` | Assign a project tag to the current task |
| `任务：生成周报汇总` | Generate and copy weekly report |
| `任务：整理工作源文件` | Compact the inbox file and archive completed tasks |
| `任务：重载插件` | Hot-reload the plugin |

### Task Syntax

Standard Markdown task lists with inline metadata:

```
- [ ] Fix authentication bug #WAIT @alice 确认登录流程 #C3
- [x] Deploy to staging ✅ 2026-04-08
```

**Time range:** `09:00 - 10:30`
**Scheduled:** `⏳ 2026-04-10`
**Due:** `📅 2026-04-15`

### Task Note Format

Tasks can have an associated note block:

```
- [ ] Review Q2 report #P/finance
  Note: Review Q2 financial report before team sync
  ## Tasks
  - [ ] Read executive summary
  - [x] Check revenue charts
```

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Primary Inbox | `📥 任务收件箱.md` | Main task capture file |
| Archive Root | `_archives/tasks` | Where archived tasks are stored |
| Backup Directory | `_system/task-workflow/backups` | Auto-backup location |
| Workspace Directory | `_system/task-workflow/workspaces` | Workspace metadata |
| Auto-backup | On | Create snapshot before each write |
| Backup Retention | 14 days | Days to keep backups |

---

## Data Storage

- **Task data** — stored in your existing Markdown files (inbox + archive folders)
- **Plugin state** — stored in `obsidian-plugin-data.json` (inbox paths, workspace tabs, UI state)
- **Backups** — compressed snapshots in `_system/task-workflow/backups/`
- **Archived tasks** — one file per month in `_archives/tasks/YYYY-MM/`

---

## Keyboard Shortcuts

The plugin registers the following editor actions (via CodeMirror extension):

- Click the clock icon → insert time range
- Click the checklist icon → triage workflow tag
- Click the calendar icon → set scheduled/due date
- Click the folder icon → assign project tag

---

## Changelog

### v0.2.1
- Refactored main entry point: extracted EmbeddedWorkspaceRenderer
- Debounced `layout-change` events to reduce save frequency
- Fixed off-by-one bug in inline action widget
- Fixed `#daily` tasks appearing indefinitely in today view
- Added `onClose` cleanup to TodayPanelView and all Modal classes
- Modal error handling: failed operations now show a Notice
- Debounced name input in workspace tabs editor
- CSS: fixed self-referential font variable, magic values, duplicate rules
- Added precompiled regex constants and TIMING configuration
- Build: upgraded esbuild target to es2020, added sourcemap/minify for production

### v0.2.0
- Added project aggregation panel with risk indicators
- Added subtasks with sync block
- Added weekly report generator
- Added archive workflows (knowledge + evidence)
- Added auto-compaction of inbox files
- Added inline editor action buttons

---

## License

MIT © 2026 Oscar Shao
