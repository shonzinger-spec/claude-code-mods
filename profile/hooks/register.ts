import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'profile',
      description: '/profile <trading|business|coding|all|list|measure>: switch which plugins load next session',
    })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'profile' }, async ($, e) => {
    const arg = e.args.trim()
    const subcommand = !arg || arg === 'list' ? 'list' : arg === 'measure' ? 'measure' : 'switch'
    const argv = ['python3', `${$.plugin.root}/scripts/profile.py`, subcommand]
    if (subcommand === 'switch') argv.push(arg)
    const run = await $.process.run(argv, { timeoutMs: 30000 })
    return { text: run.exitCode === 0 ? run.stdout : run.stderr }
  })
}
