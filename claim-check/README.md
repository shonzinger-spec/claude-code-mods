# claim-check

## What it does
Checks PF/profit factor, Sharpe, win-rate, and t-stat numbers in the main assistant reply against numeric values seen in the user's prompts and tool results this session. It warns once per turn for unbacked precision; it never changes or blocks the reply.

## Commands it adds
- `/claims` — report the last reply's checked metrics, backing status, and nearest corpus number.

## Files it reads and writes
- **Reads:** session prompts, tool results, and the final assistant reply through the Claude session API.
- **Writes:** nothing on disk; the numeric corpus and last report are in memory only and reset each session.

## When it runs (hooks/events)
- `session.start`: clears in-memory state and registers `/claims`.
- `prompt.submit`: adds user text to the numeric corpus.
- `tool.call`: adds returned tool-result text to the corpus.
- `turn.complete`: for a main-agent answer only, checks the reply and toasts if any metric is unbacked.

## How to turn it off
- `claude plugin disable claim-check@shon-mods`, or set `"claim-check@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.

## How to test it
```
claude plugin test claim-check
```
