import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Health, Level } from '../types'

const health = atom({ plugin: 'session-health', key: 'health' } as const, null)
const compactions = atom({ plugin: 'session-health', key: 'compactions' } as const, 0)
const handoffSent = atom({ plugin: 'session-health', key: 'handoffSent' } as const, false)

// Long context and repeated compaction are the main known causes of a session
// drifting from the truth; failed tool calls (edits that miss, files not found)
// are the visible sign it is working from a stale picture.
const CAUTION_PCT = 50
const NEW_PCT = 75
const WINDOW = 20
const CAUTION_ERRORS = 4
const NEW_ERRORS = 7

export function assess(pct: number, compacted: number, errors: number): { level: Level; reasons: string[] } {
  const reasons: string[] = []
  let level: Level = 'ok'
  const bump = (to: Level, why: string) => {
    reasons.push(why)
    if (to === 'new-session' || level === 'ok') level = to
  }
  if (pct >= NEW_PCT) bump('new-session', `context ${pct}% full`)
  else if (pct >= CAUTION_PCT) bump('caution', `context ${pct}% full`)
  if (compacted >= 2) bump('new-session', `compacted ${compacted}x (detail lost each time)`)
  else if (compacted === 1 && pct >= 60) bump('new-session', 'compacted once and filling again')
  else if (compacted === 1) bump('caution', 'compacted once')
  if (errors >= NEW_ERRORS) bump('new-session', `${errors} of last ${WINDOW} tool calls failed`)
  else if (errors >= CAUTION_ERRORS) bump('caution', `${errors} of last ${WINDOW} tool calls failed`)
  return { level, reasons }
}

// Plain-English verdicts: one light, one instruction.
export const VERDICT: Record<Level, string> = {
  ok: '🟢 Keep going',
  caution: '🟡 Finish this task, then start a new session',
  'new-session': '🔴 Start a new session now',
}

const light = (v: number, yellow: number, red: number) => (v >= red ? '🔴' : v >= yellow ? '🟡' : '🟢')

// The full /health report: verdict, then each of the three checks with its limits.
export function explain(pct: number, compacted: number, errors: number, usd: number): string {
  const { level } = assess(pct, compacted, errors)
  const squashLight = compacted >= 2 || (compacted === 1 && pct >= 60) ? '🔴' : compacted === 1 ? '🟡' : '🟢'
  return [
    VERDICT[level],
    '',
    `${light(pct, CAUTION_PCT, NEW_PCT)} Memory used: ${pct}%  (yellow at ${CAUTION_PCT}%, red at ${NEW_PCT}%)`,
    `${squashLight} Times memory was squashed (compacted): ${compacted}  (yellow at 1, red at 2)`,
    `${light(errors, CAUTION_ERRORS, NEW_ERRORS)} Failed steps in last ${WINDOW}: ${errors}  (yellow at ${CAUTION_ERRORS}, red at ${NEW_ERRORS})`,
    '',
    level === 'ok'
      ? 'All green. Nothing to do.'
      : level === 'caution'
        ? 'Fine for small stuff. Before starting anything big, type /handoff, then open a new session.'
        : 'Type /handoff (saves your progress), then open a new session and paste the resume line it gives you.',
    `Cost so far: $${usd.toFixed(2)}`,
  ].join('\n')
}

export const HANDOFF_PROMPT = [
  '[session-health] This session is worn enough that its answers may drift. Before anything else:',
  '1. Write a handoff file. If the working directory is the home folder, save it as ~/.claude/handoffs/<YYYY-MM-DD>-<short-topic>.md; otherwise save it as HANDOFF.md in the working directory (update it if it exists). Sections: Goal, Done (each item with its evidence: file path, command run, result), Remaining, Key decisions and why, Failed approaches (do not retry), Next steps, Blockers. Only write what a tool result in this session shows; mark anything else UNVERIFIED.',
  '2. Check CLAUDE.md for accuracy: the CLAUDE.md in the working directory (if any) and any lines in ~/.claude/CLAUDE.md that this session added or relied on. Verify each factual claim (paths, commands, file names, statuses) against the disk with tool calls. Fix lines that are wrong or out of date; add nothing speculative. List what you changed.',
  '3. End with one line I can paste into a new session to resume, pointing at the handoff file.',
  'Keep tool calls few and output short.',
].join('\n')

async function refresh($: EngineInterface, errors: number): Promise<Health> {
  const u = await $.session.usage()
  const ctx = u.context
  const raw = ctx.percent ?? (ctx.tokens && ctx.window ? (ctx.tokens / ctx.window) * 100 : 0)
  const pct = Math.round(raw)
  const { level, reasons } = assess(pct, await read($, compactions), errors)
  const h: Health = { level, reasons, percent: pct, usd: u.cost?.usd ?? 0 }
  await update($, health, () => h)
  $.ui.status(`${VERDICT[level]} · memory ${pct}%`)
  return h
}

async function sendHandoff($: EngineInterface) {
  await update($, handoffSent, () => true)
  await $.prompt.submit({ text: HANDOFF_PROMPT })
}

export const register: Register = on => {
  const recent: boolean[] = []
  const errs = () => recent.filter(Boolean).length

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    recent.push(r.deny === undefined && r.isError === true)
    if (recent.length > WINDOW) recent.shift()
    return r
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!('skip' in r)) await update($, compactions, n => n + 1)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const h = await refresh($, errs())
    if (h.level === 'new-session' && !(await read($, handoffSent))) {
      $.ui.toast(`Start a new session: ${h.reasons.join('; ')}. Saving handoff first.`)
      await sendHandoff($)
    }
    return r
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'health', description: 'Show why session-health rates this session as it does' })
    await $.command.register({ name: 'handoff', description: 'Save a verified handoff file and check CLAUDE.md now' })
    return r
  })

  on('command.run', { command: 'health' }, async $ => {
    const h = await refresh($, errs())
    return { text: explain(h.percent, await read($, compactions), errs(), h.usd) }
  })

  on('command.run', { command: 'handoff' }, async $ => {
    await sendHandoff($)
    return { text: 'Handoff queued: Claude will save it and check CLAUDE.md next.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const h = await read($, health)
    if (e.props.hasSurvey || !h || h.level === 'ok') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (h.level === 'caution') {
      return (
        <Box>
          <Text color="yellow">{VERDICT.caution}. Why: {h.reasons.join('; ')}. Type /health for details.</Text>
        </Box>
      )
    }
    const sent = await read($, handoffSent)
    return (
      <Box flexDirection="column">
        <Text color="red" bold>{VERDICT['new-session']}. Why: {h.reasons.join('; ')}. Answers here may get unreliable.</Text>
        <Box>
          <Text dimColor>{sent ? 'Handoff saved or queued. Open a new session and paste the resume line. ' : ''}</Text>
          <Button key="handoff" label={sent ? 'Save handoff again' : 'Save handoff now'} onPress={() => sendHandoff($)} />
        </Box>
      </Box>
    )
  })
}
