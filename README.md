# Claude Code mods - Shon Zinger

These are customisations to Claude Code's interface and behaviour: hooks that run before or after tool calls, status-line and above-the-prompt bands, side panes, and slash commands. Each mod is a Claude Code plugin. Its `hooks/hooks.json` points at a TypeScript module (`{ "modules": ["./register.ts"] }`, or `register.tsx` for mods that draw UI) that registers the behaviour with Claude Code, and a few mods add a small Python or Node helper script. The plugins are listed in `.claude-plugin/marketplace.json`, a marketplace named `shon-mods`.

## Install

Add this repository as a marketplace, then install the plugins you want. The source can be a local path or the GitHub repository:

```
claude plugin marketplace add <path-or-github-repo>
claude plugin install effort-router@shon-mods
```

After editing a mod, run `/reload-plugins`. To switch one off, run `claude plugin disable <name>@shon-mods`. Most mod folders have their own tests (`free-fallback` is a plain script); run them with `claude plugin test <folder>` (this runs every `*.test.ts` and `*.test.tsx` under the folder). The `profile` helper also has Python tests: `python3 -m unittest discover -s profile/scripts -p 'test_*.py'`.

`session-health` lives in `session-health-mkt/session-health` and is listed in the marketplace above. `session-health-mkt` is also a one-plugin marketplace of its own (`local-session-health`).

## Mods

| Mod | What it does | Type |
|---|---|---|
| effort-router | Picks the effort level (low to max) and whether to opt a turn into ultracode for every prompt. Thanks and similar get low; everything else goes to a Haiku classifier that reads the request and the last reply, with calibration rules on top and keyword rules from `config.json` as a fallback. Overrides: `!low`, `!med`, `!high`, `!xhigh`, `!max`, `!ultra`, `!solo`; `/effort-router` shows the last decision and switches routing on or off. Measured on 200 of the author's real prompts (two Sonnet labelers, Opus settling disagreements; tuned on 120, 80 held out): 60% exact on the held-out set (v1: 51%), 96% within one level (v1: 89%), 1.3% two or more levels too low (v1: 7.5%); ultracode precision 0.63, recall 0.56. The labeled prompt set is not published, so `eval/score.mjs` needs your own labeled file. | Prompt hook, slash command, status line |
| output-cap | When a Bash command prints more than 150 lines, Claude reads the first 75 and last 75 with a note of how many were cut. stdout and stderr share the budget; errored results are capped too. The command itself runs unchanged. | Tool-call hook |
| paste-dedupe | Replaces a run of 8 or more lines (300+ non-space characters) that repeats an earlier prompt in the session with `[same as message N: ...]`, so the same log or file is not sent twice. | Prompt hook |
| cost-band | Shows session cost and API cache-read ratio in the status line, an amber band above the prompt from a configurable nudge cost (default $15) and red at the limit (default $20), with one toast per level. | Status line, band above the prompt |
| session-health | Rates the session ok, caution or new-session from context fill, compaction count and failed tool calls among the last 20. At red it shows a banner and submits a handoff prompt. `/health` and `/handoff` commands. | Status line, band, slash commands |
| profile | `/profile trading\|business\|coding\|all` changes which plugin set loads in the next session and keeps a restorable snapshot; `/profile measure` estimates the fixed prompt overhead of the current set. Stdlib-only Python helper. `profiles.json` is a small sample of plugin sets; replace the plugin IDs with yours. | Slash command, Python script |
| sharpen | Turns a rough request into a clear, complete brief before Claude starts: automatically for prompts of 15 or more words, with a `++` prefix to force it, `--` to skip, and `/sharpen` to produce a brief for another AI. It reads an optional `context.md` about the user; none is shipped. | Prompt hook, slash command |
| folder-guard | Refuses to create a new loose file or folder in `~`, `~/Desktop` or `~/Documents` (Write, NotebookEdit and Bash redirects, `touch`, `mkdir`, `cp`, `mv`) and suggests a project folder. Existing items and dot-folders pass. The folder names are the author's own; edit `hooks/lib.ts`. | Tool-call guard |
| long-run | Remembers how long each backtest-like Python command took, refuses a foreground re-run of one that took 2 minutes or more (asks for `run_in_background`), and sends a desktop notification when a long run finishes. | Tool-call hook |
| prereg | `/prereg <slug> <plan>` has Claude write a pre-registration file (hypothesis, data, gates, SHA256) before any result is seen. A guard then refuses writes to it once results exist. `scripts/prereg.py` has `create`, `verify`, `judge`, `result` and `list`. | Slash command, tool-call guard, Python script |
| claim-check | Compares PF, Sharpe, win-rate and t-stat numbers in the final reply with numbers seen in prompts and tool results this session, and toasts once per turn for any that nothing backs. `/claims` lists them. It never changes or blocks the reply. | Turn hook, slash command |
| holdout-vault | Keeps listed holdout files sealed: writes are refused, opening one asks first and appends a BURNED record to a ledger, and `/burn <slug>` spends one by hand. The list lives in a `vault.json` that you write; none is shipped. | Tool-call guard, slash command |
| autorank-pane | `/autorank` opens a pane summarising outreach follow-ups, queued first touches and replies from the author's own AutoRank repository. It sends nothing. It needs that repository, so treat it as an example of a data pane. | Pane, slash command |
| free-fallback | `claude-free` is a shell launcher that runs Claude Code against a local Ollama model, or an OpenRouter free model with `--openrouter`, when Anthropic usage limits are reached. The OpenRouter key is read from `~/.openrouter_key` at run time. | Shell script |

## Excluded

13 other directories from the source repository are not published. They depend on private data and local-only configuration, or are not the author's own work.

## Author

Shon Zinger

## Credits

Designed and directed by Shon Zinger; implemented with Claude Code (Anthropic) as a coding assistant.
