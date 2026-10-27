import type { EngineInterface, Register } from 'claude-code'

import { check, claimsReport, Corpus, extractClaims, toastText, type Checked } from './lib'

// Module memory only: nothing survives across sessions.
const corpus = new Corpus()
let last: Checked[] | null = null

function resultText(r: { text?: string; result?: unknown }): string {
  if (typeof r.text === 'string') return r.text
  if (typeof r.result === 'string') return r.result
  try {
    return JSON.stringify(r.result) ?? ''
  } catch {
    return ''
  }
}

async function finalReply($: EngineInterface, answer: string): Promise<string> {
  if (answer) return answer
  const rows = await $.session.messages()
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.role === 'assistant') return rows[i]!.text
  return ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    corpus.clear()
    last = null
    const r = await next(e)
    await $.command.register({ name: 'claims', description: 'claim-check: metrics in the last reply, backed or not, with the nearest corpus number' })
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    corpus.add(e.text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    corpus.add(resultText(r))
    return r
  }).catch(($, e, next) => next(e))

  // Main loop only: a subagent's report reaches the corpus as its Agent tool result.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return r
    const checked = extractClaims(await finalReply($, e.answer)).map(c => check(c, corpus.numbers()))
    last = checked
    const t = toastText(checked)
    if (t) $.ui.toast(t)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'claims' }, async () => ({ text: claimsReport(last) }))
}
