// Pure logic for claim-check: a capped corpus of numbers seen in tool results
// and user prompts, metric extraction from a reply, and precision-aware matching.

export const CORPUS_CAP_BYTES = 2_000_000

export type Kind = 'PF' | 'Sharpe' | 'WR' | 't'

export type Claim = {
  kind: Kind
  /** The number as written, sign kept, e.g. "-2.17". */
  raw: string
  value: number
  decimals: number
  isPercent: boolean
}

export type Checked = Claim & { isBacked: boolean; nearest: string | null }

type Chunk = { nums: string[]; bytes: number }

// A number not glued to a word or a decimal point before it; a sign counts only
// when nothing word-like precedes it ("t=-2.17" is negative, "1.2-1.5" is not).
const NUM = /(?<![\w.])([-+−]?)(\d+(?:\.\d+)?)(?![\w])/g

export class Corpus {
  private chunks: Chunk[] = []
  private bytes = 0

  add(text: string): void {
    if (!text) return
    const t = text.length > CORPUS_CAP_BYTES ? text.slice(-CORPUS_CAP_BYTES) : text
    const nums = [...new Set(numbersIn(t))]
    if (nums.length === 0) return
    this.chunks.push({ nums, bytes: t.length })
    this.bytes += t.length
    while (this.bytes > CORPUS_CAP_BYTES && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()!.bytes
    }
  }

  *numbers(): Generator<string> {
    for (const c of this.chunks) yield* c.nums
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
}

export function numbersIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(NUM)) out.push(`${m[1] === '−' ? '-' : m[1] === '+' ? '' : m[1]}${m[2]}`)
  return out
}

const SEP = String.raw`\s*(?:[=:≈~]|\b(?:of|is|was|at|around|about|near)\b)?\s*`
const VAL = String.raw`([-+−]?\d+(?:\.\d+)?)(\s?%)?(?![\w]|\.\d)`

// Word labels: case-insensitive. "Sharpe-like 1.2" fails because "-like" is no separator.
const LABELED = new RegExp(
  String.raw`(?<![\w'’-])(PF|profit[- ]factor|Sharpe(?:\s+ratio)?|win[- ]?rate|WR)(?![\w-])` + SEP + VAL,
  'gi',
)
// t-stat: "t-stat 2.1", "t-statistic of 2.1", or a bare lowercase "t" with "=", ":" or a space.
const TSTAT = new RegExp(
  String.raw`(?<![\w'’-])(?:[tT]-stat(?:istic)?(?![\w-])` + SEP + String.raw`|t(?:\s*[=:]\s*|\s+))` + VAL,
  'g',
)

function kindOf(label: string): Kind {
  const l = label.toLowerCase()
  if (l === 'pf' || l.startsWith('profit')) return 'PF'
  if (l.startsWith('sharpe')) return 'Sharpe'
  return 'WR'
}

function claimOf(kind: Kind, num: string, pct: string | undefined): Claim {
  const raw = num.replace('−', '-').replace(/^\+/, '')
  const dot = raw.indexOf('.')
  return { kind, raw, value: Number(raw), decimals: dot < 0 ? 0 : raw.length - dot - 1, isPercent: !!pct }
}

export function extractClaims(text: string): Claim[] {
  const found: { at: number; c: Claim }[] = []
  for (const m of text.matchAll(LABELED)) found.push({ at: m.index ?? 0, c: claimOf(kindOf(m[1]!), m[2]!, m[3]) })
  for (const m of text.matchAll(TSTAT)) found.push({ at: m.index ?? 0, c: claimOf('t', m[1]!, m[2]) })
  return found.sort((a, b) => a.at - b.at).map(f => f.c)
}

const EPS = 1e-9

/** The values a corpus number may stand for: itself, and for a win rate its percent or fraction form. */
function candidates(claim: Claim, v: number): number[] {
  if (claim.kind !== 'WR') return [v]
  const asPct = claim.isPercent || claim.value > 1
  return asPct ? [v, v * 100] : [v, v / 100]
}

/** Backed when some corpus number rounds (half-up or half-even) to the claim at its decimals. */
export function check(claim: Claim, corpus: Iterable<string>): Checked {
  const tol = 0.5 * 10 ** -claim.decimals + EPS
  let nearest: string | null = null
  let best = Infinity
  for (const s of corpus) {
    const v = Number(s)
    for (const x of candidates(claim, v)) {
      const d = Math.abs(x - claim.value)
      if (d <= tol) return { ...claim, isBacked: true, nearest: s }
      if (d < best) {
        best = d
        nearest = s
      }
    }
  }
  return { ...claim, isBacked: false, nearest }
}

export function label(c: Claim): string {
  return `${c.kind} ${c.raw}${c.isPercent ? '%' : ''}`
}

export function toastText(checked: Checked[]): string | null {
  const bad = checked.filter(c => !c.isBacked)
  if (bad.length === 0) return null
  return `claim-check: ${bad.length} unbacked metric(s): ${bad.map(label).join(', ')}. /claims for detail`
}

export function claimsReport(checked: Checked[] | null): string {
  if (checked === null) return 'claim-check: no reply checked yet this session.'
  if (checked.length === 0) return 'claim-check: the last reply quoted no PF / Sharpe / win-rate / t numbers.'
  const lines = checked.map(c =>
    `${c.isBacked ? 'backed  ' : 'UNBACKED'}  ${label(c)}  (nearest corpus number: ${c.nearest ?? 'none'})`,
  )
  const n = checked.filter(c => !c.isBacked).length
  return [`claim-check: last reply, ${checked.length} metric(s), ${n} unbacked`, ...lines].join('\n')
}
