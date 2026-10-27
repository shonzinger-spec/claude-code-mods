import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { check, extractClaims, numbersIn } from './lib'

const show = (text: string) => extractClaims(text).map(c => `${c.kind} ${c.raw}${c.isPercent ? '%' : ''}`)
const backed = (reply: string, corpus: string) => extractClaims(reply).map(c => check(c, numbersIn(corpus)).isBacked)

// ---- extraction ----
test('extracts each metric spelling', () => {
  expect(show('PF 1.31, profit factor of 1.29, PF=1.4 and Sharpe 0.85')).toEqual(['PF 1.31', 'PF 1.29', 'PF 1.4', 'Sharpe 0.85'])
  expect(show('win rate 54% and WR 54.2%, Sharpe ratio: 1.1')).toEqual(['WR 54%', 'WR 54.2%', 'Sharpe 1.1'])
  expect(show('t=2.1, t 2.1, t-stat 2.1, t -2.17, T-stat of 3')).toEqual(['t 2.1', 't 2.1', 't 2.1', 't -2.17', 't 3'])
})

test('words and lookalikes are not mis-extracted', () => {
  expect(show('sized at 1.5x, a Sharpe-like 1.2 score, I don\'t 3 times, part 3, PFX 2.0, wrap 4')).toEqual([])
  expect(show('the fix and test pass; 12 files changed')).toEqual([])
})

// ---- matching ----
test('rounded match: corpus 1.3127 backs PF 1.31 but not PF 1.32', () => {
  expect(backed('PF 1.31', 'profit_factor=1.3127')).toEqual([true])
  expect(backed('PF 1.32', 'profit_factor=1.3127')).toEqual([false])
  expect(backed('PF 1.310', 'pf 1.3')).toEqual([false])
})

test('percent equivalence both ways for win rate', () => {
  expect(backed('WR 54%', 'win_rate 0.5412')).toEqual([true])
  expect(backed('win rate 54.2%', 'wr=54.18')).toEqual([true])
  expect(backed('win rate 0.54', 'hit 54.0%')).toEqual([true])
  expect(backed('WR 61%', 'win_rate 0.5412')).toEqual([false])
})

test('sign is kept: t -2.17 needs a negative corpus number', () => {
  expect(backed('t -2.17', 'tstat=-2.1693')).toEqual([true])
  expect(backed('t -2.17', 'tstat=2.17')).toEqual([false])
  expect(backed('t 1.5', 'range 1.2-1.5')).toEqual([true])
})

test('integers round at zero decimals', () => {
  expect(backed('t 3', 't=3.4')).toEqual([true])
  expect(backed('t 3', 't=3.6')).toEqual([false])
})

// ---- end to end through the hooks ----
function engine(on: On, toasts: string[], toolText: string) {
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: toolText }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('session.messages', () => ({ value: [] }))
}

const turn = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const })
const RUN = { command: 'claims', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never

test('an unbacked PF in the reply toasts once and /claims lists it', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'n=212 profit_factor=1.3127 sharpe=0.8512')
  await $.tool.call({ tool: 'Bash', command: 'python bt.py' })
  await $.turn.complete(turn('Result: PF 1.42, Sharpe 0.85, t 2.9.'))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('2 unbacked metric(s): PF 1.42, t 2.9')
  const r = await $.command.run(RUN)
  expect(r.text ?? '').toContain('UNBACKED  PF 1.42  (nearest corpus number: 1.3127)')
  expect(r.text ?? '').toContain('backed    Sharpe 0.85')
})

test('a rounded match stays quiet', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'profit_factor=1.3127')
  await $.tool.call({ tool: 'Bash', command: 'python bt.py' })
  await $.turn.complete(turn('The honest PF 1.31 fails the gate.'))
  expect(toasts).toEqual([])
})

test('a number from the user prompt backs the reply', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, '')
  await $.prompt.submit({ text: 'last run gave WR 0.538, is that ok?', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(turn('A win rate of 54% is fine.'))
  expect(toasts).toEqual([])
})

test('a reply with no metrics stays quiet', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'ok')
  await $.turn.complete(turn('Renamed the file and the tests pass at 1.5x speed.'))
  expect(toasts).toEqual([])
  const r = await $.command.run(RUN)
  expect(r.text ?? '').toContain('quoted no PF')
})
