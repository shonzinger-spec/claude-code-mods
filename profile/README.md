# profile

## What it does
`/profile` changes the `enabledPlugins` set that Claude Code will load in a **new session**. It has focused `trading`, `business`, and `coding` sets, each combined with the always-on core set. `/profile all` restores the full enabled-plugin snapshot made on the first switch.

Plugins supplied by the Claude desktop app, rather than by `~/.claude/settings.json` → `enabledPlugins`, are not affected.

## Commands it adds
- `/profile trading`, `/profile business`, or `/profile coding`: select that profile for the next session.
- `/profile all`: restore the original full enabled-plugin snapshot.
- `/profile` or `/profile list`: show profiles, their plugin counts, and whether the current set matches one.
- `/profile measure`: estimate the current set's fixed prompt overhead from installed skills, commands, agents, and descriptions.

## Files it reads and writes
- **Reads:** `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, and this mod's `profiles.json` (a small sample: `core`, `trading`, `business` and `coding` are the fixed set names, and the plugin IDs in them are examples to replace with your own).
- **Writes:** `~/.claude/settings.json` atomically, a timestamped settings backup under `state/`, and (once only) `state/all.json`.
- **Reads for measurement:** installed plugin directories. Missing local/directory install paths are counted as unknown and skipped.

## When it runs (hooks/events)
- `session.start`: registers `/profile`.
- `command.run` for `profile`: calls the stdlib-only Python helper with a 30-second limit. `list` is the default; `measure` measures; every other argument switches profiles.

## How to turn it off
`claude plugin disable profile@shon-mods`, or set `"profile@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.

## How to test it
```
python3 -m unittest discover -s profile/scripts -p 'test_*.py'
claude plugin test profile
```
