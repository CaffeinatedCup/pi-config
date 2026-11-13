# Pi Config Buildout Plan

Personal pi coding agent configuration. This repo is the agent directory
(`PI_CODING_AGENT_DIR=~/pi-config`, set via flake home-manager module).

## Current State

- ✅ Web search (`pi-web-access`)
- ✅ Hyper provider (`@charmland/pi-hyper-provider`)
- ✅ Repo-as-config with clean gitignore
- ✅ Workflow modes (`extensions/modes.ts`)
- ❌ Everything else below

## Phase 1: Foundation

Get the core workflow modes and daily-driver tools working.

### 1a. Modes Extension + Skills
**Done** — `extensions/modes.ts` (+ `skills/vault-notes/`, `tests/modes.test.mjs`).
Provides `/architect`, `/learn`, `/code`, `/modes`, `/mode <name>`, and `ctrl+alt+m`.

Design: a mode is four levers, only one of which is a prompt.
- **Tool gating** — `pi.setActiveTools()` strips declarations from the provider
  request, so gated tools cannot be called (architect loses `edit`/`write`).
- **Prompt** — written to `systemPromptOptions.sections.mode`, which Pi diffs and
  sends as one changed section. Returning `systemPrompt` instead (as `pirate.ts`
  does) replaces the whole prompt and costs a cache miss on every switch. Mode
  text lives in the prompt, never as `[MODE ACTIVE]` transcript messages, so
  there are no stale messages to filter on exit.
- **Interception** — `tool_call` blocks what gating cannot express: mutating
  bash in architect/learn, and any write outside the vault in learn.
- **Persistence** — `appendEntry()` + footer `setStatus`, restored on resume.

- **Architect mode** — read-only planning, tradeoffs, numbered `Plan:` output.
  Built on pi's own `plan-mode` example rather than `@narumitw/pi-plan-mode`:
  same idea, no dependency, and no injected per-turn user messages.
- **Learn mode** — Socratic co-working. Conventions live in the `vault-notes`
  skill; enforcement (vault-only writes) lives in the extension. Vault root via
  `--vault <path>` or `PI_MODES_VAULT_DIR` (default `~/vault`).
- **Code mode** — show every edit with explanation; `git add`/`commit` forbidden
  per AGENTS.md. Diff-summary overlay is still open (Phase 3a).

Tests: `node --experimental-strip-types tests/modes.test.mjs` (no model calls).

### 1b. Voice Dictation
Install `pi-dictate` (Deepgram Nova-3 streaming, `alt+m` toggle).
Needs: `sox` from nixpkgs, `DEEPGRAM_API_KEY`, clipboard tool (`wl-copy`).

### 1c. Startup Header / Dashboard
Copy amosblomqvist's `custom-header.ts` pattern. Replace default header with
custom ASCII art + status info. Edit `buildHeader()` to taste.

### 1d. Model Routing
Install `@alexeiled/pi-model-router` for prism-style classifier routing.
**Prerequisite:** decide model lineup beyond hyper (cheap/fast, strong/reasoning, fallback).
Routing is useless with only one backend.

## Phase 2: Subagents & Safety

### 2a. Subagents in Terminals
Choose between:
- `@tintinweb/pi-subagents` (gallery, Claude Code-style, fleet view)
- `pi-interactive-subagents` (amosblomqvist, async in multiplexer panes)

Both support tmux pane spawning. Evaluate which fits better.

### 2b. Bash Guard
Install amosblomqvist's `bash-guard` or `cc-safety-net` from gallery.
Block destructive commands before execution. Safety net for Code mode.

### 2c. Ask-User-Question
Install amosblomqvist's `ask-user-question.ts`. Structured UI popups for
Socratic flows in Learn mode. Serialize across extensions via shared lock.

## Phase 3: Polish & Extended Workflow

### 3a. Diff Summary Overlay
Custom extension: collect all write/edit tool calls per turn via
`tool_execution_end` events, render git-diff-style summary with model's
one-line "why" for each change. Language-agnostic (Python/Rust/C).

### 3b. HTML Viz → Obsidian
Skill convention: write viz files to `vault/Projects/viz/`. Obsidian renders
HTML in notes natively. Optionally install `pi-markdown-preview` for inline
rendered preview during authoring.

### 3c. Observational Memory
Install `pi-observational-memory` (amosblomqvist) or `pi-hermes-memory`.
Tiered session memory with deterministic compaction. Useful for long Learn
mode sessions.

### 3d. Session Analysis
Copy amosblomqvist's `analyze-sessions` skill. Python scripts for cost
rollups, prompt-pattern mining, session rendering across past sessions.

## Deferred

- **reMarkable integration** — `rmapi` pull-on-demand or Syncthing watch-folder
  when needed. Currently using Google Drive + screenshots.
- **ZD full dashboard** — startup header (Phase 1c) covers the immediate need.
  Full interactive dashboard is a large TUI project; defer until modes are solid.

## Package Inventory

| Package | Source | Status | Purpose |
|---|---|---|---|
| `pi-web-access` | npm | installed | web search, fetch, PDF, YouTube |
| `@charmland/pi-hyper-provider` | npm | installed | hyper/prism model provider |
| `extensions/modes.ts` | local | installed | /architect /learn /code modes |
| `skills/vault-notes` | local | installed | note conventions for learn mode |
| `@alexeiled/pi-model-router` | npm | planned | prism-style model routing |
| `@narumitw/pi-plan-mode` | npm | planned | architect mode reference |
| `pi-lens` | npm | planned | real-time code feedback |
| `@tintinweb/pi-subagents` | npm | evaluating | subagent orchestration |
| `pi-dictate` | git | planned | voice dictation |
| `pi-interactive-subagents` | git | evaluating | subagents in tmux panes |
| `pi-observational-memory` | npm | deferred | tiered session memory |

## Notes

- Pin versions for reproducibility once stable. Currently floating.
- `npm/` is gitignored (regenerated from `settings.json` declarations).
- `auth.json`, `sessions/`, `models-store.json` are gitignored (machine-local).
- Amos Blomqvist's [pi-config](https://github.com/amosblomqvist/pi-config) is
  the primary reference implementation. Copy pieces, don't clone wholesale.
