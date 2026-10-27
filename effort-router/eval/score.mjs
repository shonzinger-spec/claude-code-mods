// Re-score the classifier on labeled prompts: node eval/score.mjs [gold.json] [haiku_labels.json]
// Data stays out of git (eval/data/ is ignored): the prompts are yours.
// ids p000-p119 tune, p120-p199 are held out. Haiku labels come from a batch run of the router prompt,
// so the "haiku" lines estimate the live mod; the "rules" lines are exact.
import fs from 'node:fs'
import { decide, stripPastes } from '../hooks/register.ts'

const root = new URL('..', import.meta.url).pathname
const gold = JSON.parse(fs.readFileSync(process.argv[2] ?? `${root}eval/data/gold.json`, 'utf8'))
const hkPath = process.argv[3] ?? `${root}eval/data/haiku_labels.json`
const hk = fs.existsSync(hkPath) ? JSON.parse(fs.readFileSync(hkPath, 'utf8')) : {}
const c = JSON.parse(fs.readFileSync(`${root}config.json`, 'utf8'))
const home = process.env.HOME ?? ''
const folder = cwd => {
  let best
  for (const [d, l] of Object.entries(c.folders)) {
    const abs = d.replace(/^~/, home)
    if ((cwd ?? '').startsWith(abs) && (!best || abs.length > best[0])) best = [abs.length, l]
  }
  return best?.[1]
}
const ORDER = ['low', 'medium', 'high', 'xhigh']
const ix = l => ORDER.indexOf(l === 'max' ? 'xhigh' : l)

function score(name, rows, f) {
  let exact = 0, within1 = 0, under2 = 0, tp = 0, fp = 0, fn = 0
  for (const g of rows) {
    const p = f(g)
    const d = ix(p.level) - ix(g.effort)
    if (d === 0) exact++
    if (Math.abs(d) <= 1) within1++
    if (d <= -2) under2++
    if (p.ultracode && g.ultracode) tp++
    else if (p.ultracode) fp++
    else if (g.ultracode) fn++
  }
  const pct = x => `${((100 * x) / rows.length).toFixed(1)}%`
  const r = x => (Number.isFinite(x) ? x.toFixed(2) : '-')
  console.log(`${name.padEnd(34)} n=${rows.length} exact ${pct(exact)} within1 ${pct(within1)} under-by-2+ ${pct(under2)} | ultracode P ${r(tp / (tp + fp))} R ${r(tp / (tp + fn))}`)
}

for (const part of ['tune', 'held-out']) {
  const rows = gold.filter(g => Number(g.id.slice(1)) < 120 === (part === 'tune'))
  const guess = g => (hk[g.id] ? { level: hk[g.id].level, ultracode: hk[g.id].ultracode } : undefined)
  score(`haiku + calibration, ${part}`, rows, g => decide(stripPastes(g.text), g.prev, undefined, guess(g), c))
  score(`rules only (Haiku down), ${part}`, rows, g => decide(stripPastes(g.text), g.prev, undefined, undefined, c, folder(g.cwd)))
}
