import { expect, test } from 'claude-code/testing'

import { assess, explain } from './register'

test('fresh session is ok', () => {
  expect(assess(20, 0, 0).level).toBe('ok')
})

test('half-full context is caution', () => {
  expect(assess(55, 0, 0).level).toBe('caution')
})

test('75% context says start a new session', () => {
  expect(assess(76, 0, 0).level).toBe('new-session')
})

test('two compactions say start a new session even at low fill', () => {
  expect(assess(10, 2, 0).level).toBe('new-session')
})

test('one compaction plus refilling says new session', () => {
  expect(assess(62, 1, 0).level).toBe('new-session')
})

test('many failed tool calls say new session', () => {
  const r = assess(10, 0, 7)
  expect(r.level).toBe('new-session')
  expect(r.reasons.length).toBe(1)
})

test('caution never downgrades a new-session verdict', () => {
  expect(assess(80, 1, 4).level).toBe('new-session')
})

test('health report gives a plain verdict and every check', () => {
  const r = explain(58, 0, 1, 2.5)
  expect(r.startsWith('🟡 Finish this task')).toBe(true)
  expect(r.includes('Memory used: 58%')).toBe(true)
  expect(r.includes('squashed')).toBe(true)
  expect(r.includes('Failed steps')).toBe(true)
})

test('red report tells the user to run /handoff', () => {
  expect(explain(80, 0, 0, 0).includes('/handoff')).toBe(true)
})
