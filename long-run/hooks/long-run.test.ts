import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { backgroundId, isBacktest, namedIds, signature } from './lib'

const SWEEP = 'python run_sweep.py grid --seed 7 --out a.csv'
const SIG = 'python run_sweep.py grid'

test('signature: env, cd prefix, seeds and outputs are dropped; reruns share it', () => {
  expect(signature(SWEEP)).toBe(SIG)
  expect(signature('cd ~/Trading/x && SEED=3  python ./run_sweep.py grid --seed 9 --out b.csv 2>&1 | tail -5')).toBe(SIG)
  expect(signature('.venv/bin/python3.11 src/backtest.py 42 /tmp/out.json')).toBe('python src/backtest.py')
  expect(signature('uv run --with pandas python -m research.walk_forward --folds 5')).toBe('uv run python -m research.walk_forward')
  expect(signature('poetry run python bootstrap.py nq')).toBe('poetry run python bootstrap.py nq')
  expect(signature('python -c "print(1)"')).toBeNull()
  expect(signature('pip install x')).toBeNull()
  expect(signature('ls gridlines.png')).toBeNull()
})

test('matching is word-boundaried and needs a python/uv/poetry run', () => {
  for (const c of [SWEEP, 'python spa_test.py', 'python3 grid_search.py', 'uv run optimizer.py', 'python monte-carlo.py',
    'python -m lab.reality_check', 'python replay_run.py', 'python scripts/run_sweep.py', 'python backtester.py'])
    expect(isBacktest(signature(c))).toBe(true)
  for (const c of ['python space_invaders.py', 'python plot_gridlines.py', 'python -c "print(1)"', 'pip install backtesting',
    'python -m pip install backtesting', 'ls gridlines.png', 'echo backtest', 'python format.py'])
    expect(isBacktest(signature(c))).toBe(false)
})

test('background IDs come from the field or the result text; notifications match whole IDs', () => {
  expect(backgroundId({ backgroundTaskId: 'b7x' })).toBe('b7x')
  expect(backgroundId({ stdout: '' }, 'Command was moved to the background (ID: bq2c9). Output: /tmp/x')).toBe('bq2c9')
  expect(backgroundId({ stdout: 'done' })).toBeNull()
  expect(namedIds('Background command "x" (ID: bq2c9) completed', { bq2c9: { sig: 's', startedAt: 0 } })).toEqual(['bq2c9'])
  expect(namedIds('task bq2c99 completed', { bq2c9: { sig: 's', startedAt: 0 } })).toEqual([])
})

type Seen = { notes: string[]; prompts: string[]; runs: number }

function engine(on: On, runMs: number, extra: Record<string, unknown> = {}, store: Record<string, unknown> = {}): Seen {
  const seen: Seen = { notes: [], prompts: [], runs: 0 }
  const clock = mock.clock(on)
  mock.store(on, store)
  on('tool.call', async () => {
    seen.runs++
    await clock.advance(runMs)
    return { result: { stdout: 'ok', stderr: '', interrupted: false, ...extra } }
  })
  on('ui.notify', (_, e) => {
    seen.notes.push(e.text)
    return { value: { isSent: false, reason: 'no-surface' } }
  })
  on('prompt.submit', (_, e) => {
    seen.prompts.push(e.text)
    return { text: e.text, context: e.context }
  })
  return seen
}

test('history >= 120 s: a foreground re-run is denied with the minutes', async ($, on) => {
  const seen = engine(on, 1000, {}, { [`dur:${SIG}`]: { ms: 204_000, at: 1 } })
  const r = await $.tool.call({ tool: 'Bash', command: 'python run_sweep.py grid --seed 99 --out c.csv' })
  expect(r.deny).toContain('re-run with run_in_background: true (last run took 3.4m)')
  expect(seen.runs).toBe(0)
})

test('history >= 120 s: run_in_background: true is never denied', async ($, on) => {
  const seen = engine(on, 1000, { backgroundTaskId: 'bg1' }, { [`dur:${SIG}`]: { ms: 204_000, at: 1 } })
  const r = await $.tool.call({ tool: 'Bash', command: SWEEP, run_in_background: true })
  expect(r.deny).toBeUndefined()
  expect(seen.runs).toBe(1)
})

test('no history, or history of 30 s: allowed', async ($, on) => {
  const seen = engine(on, 1000, {}, { 'dur:python other_backtest.py': { ms: 30_000, at: 1 } })
  expect((await $.tool.call({ tool: 'Bash', command: SWEEP })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'python other_backtest.py --seed 3' })).deny).toBeUndefined()
  expect(seen.runs).toBe(2)
  expect(seen.notes).toEqual([])
})

test('a foreground run of >= 120 s is stored, nudged and notified; the next one is denied', async ($, on) => {
  const seen = engine(on, 150_000)
  const r = await $.tool.call({ tool: 'Bash', command: SWEEP })
  expect(r.deny).toBeUndefined()
  expect(String(r.context ?? '')).toContain('took 2.5m in the foreground')
  expect(seen.notes).toEqual([`finished ${SIG} (2.5m)`])
  const again = await $.tool.call({ tool: 'Bash', command: 'SEED=5 python run_sweep.py grid --seed 5' })
  expect(again.deny).toContain('(last run took 2.5m)')
  expect(seen.runs).toBe(1)
})

test('a short foreground run: no nudge, no notify', async ($, on) => {
  const seen = engine(on, 30_000)
  const r = await $.tool.call({ tool: 'Bash', command: SWEEP })
  expect(r.context ?? []).toEqual([])
  expect(seen.notes).toEqual([])
})

test('non-backtest python is never denied or timed', async ($, on) => {
  const seen = engine(on, 300_000)
  for (const command of ['python -c "print(1)"', 'pip install x', 'python space_invaders.py'])
    expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
  expect(seen.runs).toBe(3)
  expect(seen.notes).toEqual([])
  // timed nothing: a second round is still allowed
  expect((await $.tool.call({ tool: 'Bash', command: 'python space_invaders.py' })).deny).toBeUndefined()
})

test('background ID recorded, then the task-notification naming it notifies once', async ($, on) => {
  const seen = engine(on, 500, { backgroundTaskId: 'bq2c9' })
  await $.tool.call({ tool: 'Bash', command: SWEEP, run_in_background: true })
  expect(seen.notes).toEqual([])
  const text = '<task-notification>Background command (ID: bq2c9) completed with exit code 0</task-notification>'
  await $.prompt.submit({ text, wait: false, origin: { kind: 'task-notification' } })
  expect(seen.notes.length).toBe(1)
  expect(seen.notes[0]).toContain(`finished ${SIG}`)
  expect(seen.prompts).toEqual([text])
  await $.prompt.submit({ text, wait: false, origin: { kind: 'task-notification' } })
  expect(seen.notes.length).toBe(1)
})

test('a foreground run moved to the background (text only) is recorded too', async ($, on) => {
  const seen = engine(on, 500, { stdout: 'Command was moved to the background (ID: mv77). Output is being written to /tmp/o' })
  const r = await $.tool.call({ tool: 'Bash', command: SWEEP })
  expect(r.context ?? []).toEqual([])
  await $.prompt.submit({ text: 'Background command (ID: mv77) completed', wait: false, origin: { kind: 'task-notification' } })
  expect(seen.notes.length).toBe(1)
})

test('a composer prompt naming the ID does not notify and passes unchanged', async ($, on) => {
  const seen = engine(on, 500, { backgroundTaskId: 'bq2c9' })
  await $.tool.call({ tool: 'Bash', command: SWEEP, run_in_background: true })
  await $.prompt.submit({ text: 'is bq2c9 done yet?', wait: false, origin: { kind: 'composer' } })
  expect(seen.notes).toEqual([])
  expect(seen.prompts).toEqual(['is bq2c9 done yet?'])
})
