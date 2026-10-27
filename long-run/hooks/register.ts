import type { EngineInterface, Hook, Register } from 'claude-code'

import { backgroundId, denyText, isBacktest, LONG_MS, namedIds, notifyText, nudgeText, signature, type Pending } from './lib'

const durKey = (sig: string): string => `dur:${sig}`
const PENDING = 'pending'

async function pending($: EngineInterface): Promise<Pending> {
  const v = await $.store.get(PENDING)
  return v && typeof v === 'object' ? (v as Pending) : {}
}

async function remember($: EngineInterface, id: string, sig: string, startedAt: number): Promise<void> {
  const p = await pending($)
  p[id] = { sig, startedAt }
  await $.store.set(PENDING, p)
}

const guard: Hook<'tool.call'> = async ($, e, next) => {
  if (e.tool !== 'Bash') return next(e)
  const sig = signature(e.command)
  if (!isBacktest(sig)) return next(e)

  if (e.run_in_background !== true) {
    const last = (await $.store.get(durKey(sig))) as { ms?: number } | undefined
    if (typeof last?.ms === 'number' && last.ms >= LONG_MS) return { deny: denyText(sig, last.ms) }
  }

  const start = await $.clock.now()
  const r = await next(e)
  // The command has run: from here nothing may throw into the .catch below,
  // which would call next (run the command) a second time.
  try {
    return await afterRun($, e.run_in_background === true, sig, r, start)
  } catch {
    return r
  }
}

type Result = Awaited<ReturnType<Parameters<Hook<'tool.call'>>[2]>>

async function afterRun($: EngineInterface, isBackground: boolean, sig: string, r: Result, start: number): Promise<Result> {
  if (r.deny !== undefined) return r
  const end = await $.clock.now()

  // Started in the background, or moved there (timeout, Ctrl+B): wait for its notification.
  const id = 'result' in r ? backgroundId(r.result, r.text) : null
  if (isBackground || id) {
    if (id) await remember($, id, sig, start)
    return r
  }

  // Completed in the foreground. A long run is always kept; a short one replaces
  // the history only when it succeeded, so a quick crash does not clear it.
  const ms = end - start
  if (ms < LONG_MS) {
    if (!r.isError) await $.store.set(durKey(sig), { ms, at: end })
    return r
  }
  await $.store.set(durKey(sig), { ms, at: end })
  $.ui.notify(notifyText(sig, ms))
  if (r.isError) return r
  return { ...r, context: [...(r.context ?? []), nudgeText(sig, ms)] }
}

const watch: Hook<'prompt.submit'> = async ($, e, next) => {
  if (e.origin?.kind === 'task-notification') {
    const p = await pending($)
    const ids = namedIds(e.text, p)
    if (ids.length) {
      const now = await $.clock.now()
      for (const id of ids) {
        $.ui.notify(notifyText(p[id]!.sig, now - p[id]!.startedAt))
        delete p[id]
      }
      await $.store.set(PENDING, p)
    }
  }
  return next(e)
}

export const register: Register = on => {
  // A failure in this mod must never touch the tool call or the prompt.
  on('tool.call', guard).catch(($, e, next) => next(e))
  on('prompt.submit', watch).catch(($, e, next) => next(e))
}
