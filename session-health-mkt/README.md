# session-health-mkt (plugin: session-health)

This folder is a one-plugin **marketplace** called `local-session-health` (`.claude-plugin/marketplace.json`). The plugin itself lives in `session-health/`.

## What it does
It rates the current session 🟢 ok / 🟡 caution / 🔴 new-session using three signals: how full the context is, how many times the session has been compacted, and how many of the last 20 tool calls failed. It shows the rating in the status line and as a banner above the prompt.
When the rating first reaches 🔴, it shows a toast and automatically submits a "handoff" prompt. That prompt asks Claude to write a verified handoff file, fact-check CLAUDE.md, and give you a one-line resume command.

Thresholds (`assess()` in `session-health/hooks/register.tsx`):
- **Context:** 🟡 at ≥ 50%, 🔴 at ≥ 75%.
- **Compactions:** 🟡 after 1. 🔴 after 2, or after 1 when the context is ≥ 60% again.
- **Failed tool calls in the last 20:** 🟡 at ≥ 4, 🔴 at ≥ 7.

## Commands it adds
- `/health`: the verdict, each of the three checks with its limits, and the session cost in $.
- `/handoff`: submits the handoff prompt now.

## Files it reads and writes
- **The mod itself:** no file reads or writes. It reads `$.session.usage()` (context % or tokens/window, and cost). It keeps state in plugin atoms (`health`, `compactions`, `handoffSent`; types in `session-health/types/index.d.ts`). The list of recent tool errors is kept in memory only.
- **Through the handoff prompt, Claude is asked to write:**
  - `~/.claude/handoffs/<YYYY-MM-DD>-<topic>.md` if the working directory is home, otherwise `HANDOFF.md` in the working directory.
  - Fixes to wrong lines in the working directory's `CLAUDE.md` and in `~/.claude/CLAUDE.md`.

## When it runs (hooks/events)
- `tool.call`: after each call, records whether it errored (denied calls do not count).
- `session.compact`: adds 1 to the compaction count (unless the compaction was skipped).
- `turn.complete`: recomputes the rating, updates `$.ui.status`, and, the first time the rating is 🔴, shows a toast and sends the handoff prompt (once per session, via `handoffSent`).
- `session.start`: registers `/health` and `/handoff`.
- `ui.render` on `AbovePrompt`: a yellow line for 🟡, or a red banner with a "Save handoff now / again" button for 🔴. Nothing is shown for ok or while a survey is displayed.
- Note: `tool.call` and `session.compact` have a `.catch` pass-through. `turn.complete` and `session.start` do not.

## How to turn it off
- `claude plugin disable session-health@local-session-health`, or set `"session-health@local-session-health": false` in `~/.claude/settings.json`.
- The marketplace is registered in `settings.json` under `extraKnownMarketplaces.local-session-health` (directory source pointing at this folder).

## How to test it
Point the test at the plugin folder, not this marketplace folder (running it on `session-health-mkt` itself fails with "no hooks module to load"):
```
claude plugin test session-health-mkt/session-health
```
(9 tests in `session-health/hooks/assess.test.ts`.)

UNSURE: whether `handoffSent` (and the compaction count) reset with each new session or persist. The atoms are declared without saying how long they last.
