// ═══════════════════════════════════════════════════════════════════
// os shim for Cloudflare Workers
// ═══════════════════════════════════════════════════════════════════
//
// Drop-in replacement for Node's `os` module. Prisma's runtime imports
// `node:os` to detect platform/arch (for engine selection). On
// Cloudflare Workers, `node:os` is not implemented (unenv stubs it as
// empty). We provide a shim with all functions Prisma might call,
// returning safe defaults. The D1 driver adapter never actually uses
// the query engine binary, so these values are never consumed for
// real DB operations — they only satisfy the detection code path.

export const EOL = '\n'

export function arch(): string {
  return 'x64'
}

export function platform(): string {
  return 'linux'
}

export function hostname(): string {
  return 'cloudflare-workers'
}

export function tmpdir(): string {
  return '/tmp'
}

export function homedir(): string {
  return '/tmp'
}

export function userinfo(): { username: string; uid: number; gid: number; shell: string | null; homedir: string } {
  return { username: 'worker', uid: 0, gid: 0, shell: null, homedir: '/tmp' }
}

export function type(): string {
  return 'Linux'
}

export function release(): string {
  return '0.0.0'
}

export function uptime(): number {
  return 0
}

export function loadavg(): number[] {
  return [0, 0, 0]
}

export function totalmem(): number {
  return 1024 * 1024 * 1024
}

export function freemem(): number {
  return 512 * 1024 * 1024
}

export function cpus(): Array<{
  model: string
  speed: number
  times: { user: number; nice: number; sys: number; idle: number; irq: number }
}> {
  return [
    {
      model: 'Cloudflare Worker',
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    },
  ]
}

export function networkInterfaces(): Record<string, unknown> {
  return {}
}

export function getNetworkInterfaces(): Record<string, unknown> {
  return {}
}

export function endianness(): 'LE' | 'BE' {
  return 'LE'
}

export function availableParallelism(): number {
  return 1
}

export const constants = {
  UV_UDP_REUSEADDR: 0,
  signals: {},
  errno: {},
  dlopen: {},
  priority: {},
}

// Default export for interop
export default {
  EOL,
  arch,
  platform,
  hostname,
  tmpdir,
  homedir,
  userinfo,
  type,
  release,
  uptime,
  loadavg,
  totalmem,
  freemem,
  cpus,
  networkInterfaces,
  getNetworkInterfaces,
  endianness,
  availableParallelism,
  constants,
}
