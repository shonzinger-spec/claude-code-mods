# effort-router

Picks the effort level (low, medium, high, xhigh, max) and whether to use ultracode for every prompt you type, so small asks stay cheap and hard ones get the thinking.

**How it decides.** Thanks and similar get low. Everything else goes to Haiku, which reads your request plus the last reply. xhigh stays only with a stakes cue (real money, live account, security, irreversible) or a long, detailed request. "continue" and "do it" never drop below medium or the last job's level. If Haiku is off or slow, keyword rules from `config.json` decide.

**Ultracode.** For a big multi-part job (Haiku says so, or you write things like "all of the strats" or "go through everything we've done"), the router adds a note that opts that turn into a multi-agent workflow. When ultracode is on only as the session's default, small requests get a "work solo" note instead. Ultracode you switch on mid-session is left alone. The engine only accepts the ultracode keyword from you, so the note is how the mod does it.

**Your controls.** Start a prompt with `!low` `!med` `!high` (or `!hard`) `!xhigh` `!max`, or with `!ultra` / `!solo`; they combine (`!high !solo`). If you change effort mid-session (picker or `/effort`), routing pauses until you set it back. `/effort-router` shows the last decision; `/effort-router off|on` switches routing off or on. The status line under the prompt shows `effort: <level> · <why>`.

**Measured** on 200 of the author's real prompts (two Sonnet labelers, Opus settling disagreements; tuned on 120, checked on 80 held out): 60% exact on the held-out set (v1: 51%), 96% within one level (v1: 89%), 1.3% two or more levels too low (v1: 7.5%). Ultracode: precision 0.63, recall 0.56 (v1: 0.27, 0.44). Re-score after editing: `node eval/score.mjs`.

**Folders.** `config.json` has a `folders` map from a directory to a minimum level (the shipped example is `"~/research": "high"`); edit it, and the inline default in `hooks/register.ts`, to add your own project folders.

Install: `/plugin install effort-router@shon-mods`; after an edit, `/reload-plugins`. Tests: `claude plugin test effort-router`.
