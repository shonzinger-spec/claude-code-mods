export type Level = 'ok' | 'caution' | 'new-session'
export type Health = { level: Level; reasons: string[]; percent: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'session-health': { health: Health | null; compactions: number; handoffSent: boolean }
  }
}
