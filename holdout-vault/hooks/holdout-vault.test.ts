import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { burnedSlugs, matches } from './lib'

// /h/data/oos.parquet is a confirmed holdout; /h/link/oos.parquet is a symlink to it.
// /h/data/old.parquet is confirmed but burned per memory; /h/data/maybe.parquet is NOT confirmed.
const VAULT = {
  ledger: '~/_ledger/burns.jsonl',
  files: [
    { match: '~/data/oos.parquet', slug: 'oos', confirmed: true },
    { match: '~/data/old.parquet', slug: 'old', confirmed: true, burned_per_memory: true },
    { match: '~/data/maybe.parquet', slug: 'maybe', confirmed: false },
    { match: '~/sealed/*.enc', slug: 'enc', confirmed: true },
  ],
}

type World = { ledger: string | null; writes: number; toasts: string[] }

function engine(on: On): World {
  const w: World = { ledger: null, writes: 0, toasts: [] }
  mock.env(on, { HOME: '/h' })
  on('session.start', () => ({ cwd: '/h' }))
  on('session.cwd', () => ({ value: '/h' }))
  on('command.register', () => ({ value: { command: 'burn' } }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', (_, e) => {
    const p = (e as { path: string }).path
    if (p.endsWith('/vault.json')) return { value: JSON.stringify(VAULT) }
    if (p === '/h/_ledger/burns.jsonl' && w.ledger !== null) return { value: w.ledger }
    return { deny: 'ENOENT' }
  })
  on('fs.write', (_, e) => {
    const x = e as { path: string; text: string }
    if (x.path === '/h/_ledger/burns.jsonl') { w.ledger = x.text; w.writes++ }
    return { value: undefined }
  })
  on('fs.stat', (_, e) =>
    (e as { path: string }).path === '/h/link/oos.parquet'
      ? { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: true, realPath: '/h/data/oos.parquet' } }
      : { deny: 'ENOENT' },
  )
  on('ui.toast', (_, e) => {
    w.toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: {} }))
  return w
}

const start = { cwd: '/h', surface: 'desktop', isInteractive: true } as const
const BURN = (slug: string) => ({ command: 'burn', args: slug, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never

test('matching: exact, folder prefix, glob', () => {
  expect(matches('/h/d/x.csv', '/h/d/x.csv')).toBe(true)
  expect(matches('/h/d/x.csv', '/h/d')).toBe(true)
  expect(matches('/h/dd/x.csv', '/h/d')).toBe(false)
  expect(matches('/h/s/a.enc', '/h/s/*.enc')).toBe(true)
  expect(matches('/h/s/q/a.enc', '/h/s/*.enc')).toBe(false)
  expect(burnedSlugs('{"event":"BURNED","slug":"a"}\nnot json\n', [{ match: 'x', slug: 'b', burned_per_memory: true }])).toEqual(new Set(['b', 'a']))
})

test('writes to a confirmed holdout are refused (Write, Edit, Bash redirect, via symlink)', async ($, on) => {
  engine(on)
  await $.session.start(start)
  expect(String((await $.tool.call({ tool: 'Write', file_path: '/h/data/oos.parquet', content: 'x' })).deny)).toContain('read-only')
  expect(String((await $.tool.call({ tool: 'Edit', file_path: '/h/data/old.parquet', old_string: 'a', new_string: 'b' })).deny)).toContain('read-only')
  expect(String((await $.tool.call({ tool: 'Bash', command: 'echo x > data/oos.parquet' })).deny)).toContain('"oos"')
  expect(String((await $.tool.call({ tool: 'Write', file_path: '/h/link/oos.parquet', content: 'x' })).deny)).toContain('read-only')
})

test('opening an unburned holdout asks; a burned one is allowed', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const a = await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/oos.parquet' } })
  expect(a.decision).toBe('ask')
  expect(String(a.reason)).toContain('BURNS holdout "oos"')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'python3 -c "import sys" sealed/NQ.enc' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'head -3 /h/link/oos.parquet' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/old.parquet' } })).decision).toBe('allow')
})

test('a Read that runs burns once per slug; then it is allowed with a toast', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Read', file_path: '/h/data/oos.parquet' })
  expect(String(r.context?.join(' '))).toContain('BURNED "oos"')
  expect(w.ledger).toContain('"event":"BURNED"')
  expect(w.ledger).toContain('"slug":"oos"')
  await $.tool.call({ tool: 'Bash', command: 'wc -l data/oos.parquet' })
  expect(w.writes).toBe(1)
  expect(w.toasts.join(' ')).toContain('already burned')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/oos.parquet' } })).decision).toBe('allow')
})

test('/burn appends BURNED, then Read is allowed with a toast', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  const r = await $.command.run(BURN('enc'))
  expect(String((r as { text?: string }).text)).toContain('BURNED "enc"')
  expect(w.ledger).toContain('"slug":"enc"')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/sealed/ES.enc' } })).decision).toBe('allow')
  const c = await $.tool.call({ tool: 'Read', file_path: '/h/sealed/ES.enc' })
  expect(c.deny).toBeUndefined()
  expect(w.toasts.join(' ')).toContain('"enc" is already burned')
  expect(w.writes).toBe(1)
  expect(String(((await $.command.run(BURN('maybe'))) as { text?: string }).text)).toContain('Usage')
})

test('G-neg: an unconfirmed entry is not enforced', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  expect((await $.tool.call({ tool: 'Write', file_path: '/h/data/maybe.parquet', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/maybe.parquet' } })).decision).toBe('allow')
  await $.tool.call({ tool: 'Read', file_path: '/h/data/maybe.parquet' })
  expect(w.writes).toBe(0)
})

test('normal work: unrelated reads, writes and Bash are untouched', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  expect((await $.tool.call({ tool: 'Write', file_path: '/h/src/engine.py', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/h/data/train.parquet' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'cat data/train.parquet > /tmp/x && ls data' })).deny).toBeUndefined()
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'python3 run.py --data data/oos_notes.txt' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/train.parquet' } })).decision).toBe('allow')
  expect(w.writes).toBe(0)
  expect(w.toasts).toEqual([])
})
