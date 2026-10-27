# long-run

## What it does
It times Bash commands that look like backtests: python / uv run / poetry run commands whose script, module or subcommand contains a word such as backtest, sweep, walkforward, optimize, monte-carlo, bootstrap, reality-check, replay, grid or spa, or whose script name starts with `run_`.
If a command signature last took 2 minutes or more in the foreground, it refuses to run it in the foreground again and asks for `run_in_background: true`. It also sends a desktop notification when a long run finishes, whether it ran in the foreground or the background.

## Commands it adds
None.

## Files it reads and writes
- No files on disk.
- Uses the plugin's key-value store (`$.store`), which persists between sessions:
  - `dur:<signature>` → `{ ms, at }`: last duration of that command signature.
  - `pending` → `{ <backgroundTaskId>: { sig, startedAt } }`: background runs still waiting for their finish notification.
- A signature keeps the interpreter, the script or `-m module`, and one bare subcommand word. It drops flags, values, `cd X &&`, `VAR=` prefixes and the wrappers env/time/nohup/caffeinate/exec. Example: `python run_sweep.py grid`.
- `python -c` gets no signature, so it is never handled.

## When it runs (hooks/events)
- `tool.call` (Bash only):
  - Before the run: if the stored duration is ≥ 120 000 ms (`LONG_MS`) and the call is not backgrounded, the call is denied.
  - After the run: if the run was backgrounded, or moved to the background (a task ID is found in the result), it is added to `pending`.
  - If the run finished in the foreground: a run under 2 minutes updates the stored time only if it succeeded. A run of 2 minutes or more always stores its time, sends `$.ui.notify("finished <sig> (N.Nm)")` and, if it succeeded, adds a nudge to the context.
- `prompt.submit` with `origin.kind === 'task-notification'`: when the text names a pending task ID, it sends a notification with the elapsed minutes and removes that ID from `pending`.
- Both hooks have a `.catch` that passes the call through, so a long-run failure never blocks the command.

## How to turn it off
- `claude plugin disable long-run@shon-mods`, or set `"long-run@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.
- To lift the refusal for one command without turning the mod off: run that command in the background once. A successful foreground run under 2 minutes also overwrites the stored time, but the foreground run is refused while the stored time is ≥ 2 minutes, so in practice use the background run.

## How to test it
```
claude plugin test long-run
```
(12 tests in `hooks/long-run.test.ts`.)

UNSURE: where the engine keeps `$.store` data on disk, and how to reset a stored duration by hand. The code does not show either.
