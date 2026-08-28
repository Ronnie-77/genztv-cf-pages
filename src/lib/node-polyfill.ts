// ═══════════════════════════════════════════════════════════════════
// Node.js polyfills for Cloudflare Workers
// ═══════════════════════════════════════════════════════════════════
//
// Cloudflare Workers (via unenv + nodejs_compat) provides partial Node.js
// support. Some modules are NOT implemented:
//   - node:fs   → readdir, readdirSync, statSync etc. missing
//   - node:os   → entirely missing
//
// Prisma's `prisma-client-js` runtime calls these during client init
// (engine detection, platform detection). With a D1 driver adapter,
// the engine binary is never actually used — so we can safely stub
// these calls to no-ops.
//
// This file MUST be imported before @prisma/client.
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// 1. Patch node:fs
// ───────────────────────────────────────────────────────────────────
import * as fs from 'node:fs'

type Callback = (err: NodeJS.ErrnoException | null, result?: unknown) => void

const isStubbed = (fn: unknown): boolean =>
  typeof fn !== 'function' || String(fn).includes('not implemented')

if (isStubbed((fs as Record<string, unknown>).readdir)) {
  ;(fs as Record<string, unknown>).readdir = function (
    _path: string,
    _options: unknown,
    callback?: Callback
  ): void {
    if (typeof _options === 'function' && callback === undefined) {
      callback = _options as Callback
    }
    if (callback) callback(null, [])
  }
}

if (isStubbed((fs as Record<string, unknown>).readdirSync)) {
  ;(fs as Record<string, unknown>).readdirSync = function (): string[] {
    return []
  }
}

if (isStubbed((fs as Record<string, unknown>).existsSync)) {
  ;(fs as Record<string, unknown>).existsSync = function (): boolean {
    return false
  }
}

if (isStubbed((fs as Record<string, unknown>).statSync)) {
  ;(fs as Record<string, unknown>).statSync = function () {
    return {
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 0,
      mtime: new Date(0),
      ctime: new Date(0),
      birthtime: new Date(0),
    }
  }
}

if (isStubbed((fs as Record<string, unknown>).lstatSync)) {
  ;(fs as Record<string, unknown>).lstatSync = function () {
    return {
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 0,
      mtime: new Date(0),
      ctime: new Date(0),
      birthtime: new Date(0),
    }
  }
}

if (isStubbed((fs as Record<string, unknown>).readFile)) {
  ;(fs as Record<string, unknown>).readFile = function (
    _path: string,
    _options: unknown,
    callback?: Callback
  ): void {
    if (typeof _options === 'function' && callback === undefined) {
      callback = _options as Callback
    }
    if (callback) callback(null, '')
  }
}

if (isStubbed((fs as Record<string, unknown>).readFileSync)) {
  ;(fs as Record<string, unknown>).readFileSync = function (): string {
    return ''
  }
}

if (isStubbed((fs as Record<string, unknown>).accessSync)) {
  ;(fs as Record<string, unknown>).accessSync = function (): void {
    /* no-op */
  }
}

if (isStubbed((fs as Record<string, unknown>).realpathSync)) {
  ;(fs as Record<string, unknown>).realpathSync = function (p: string): string {
    return p
  }
}

// ───────────────────────────────────────────────────────────────────
// 2. Patch node:os (entirely missing on Workers)
// ───────────────────────────────────────────────────────────────────
// We register a minimal `os` module shim in the global module registry
// so that `import 'node:os'` resolves to it.
//
// Prisma uses os for: platform(), arch(), hostname(), tmpdir(), cpus(),
// totalmem(), freemem(), networkInterfaces(), EOL. All can be stubbed.

const osShim = {
  EOL: '\n',
  arch: () => 'x64',
  platform: () => 'linux',
  hostname: () => 'localhost',
  tmpdir: () => '/tmp',
  homedir: () => '/tmp',
  userinfo: () => ({ username: 'worker', uid: 0, gid: 0, shell: null, homedir: '/tmp' }),
  type: () => 'Linux',
  release: () => '0.0.0',
  uptime: () => 0,
  loadavg: () => [0, 0, 0],
  totalmem: () => 1024 * 1024 * 1024,
  freemem: () => 512 * 1024 * 1024,
  cpus: () => [
    {
      model: 'Cloudflare Worker',
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    },
  ],
  networkInterfaces: () => ({}),
  getNetworkInterfaces: () => ({}),
  constants: {
    UV_UDP_REUSEADDR: 0,
    signals: {},
    errno: {},
    dlopen: {},
    priority: {},
  },
  endianness: () => 'LE',
  availableParallelism: () => 1,
}

// Register the shim so `import 'node:os'` resolves to it.
// unenv provides a module registry; we hook into it.
try {
  // @ts-expect-error — unenv internal
  const __require = globalThis.require || globalThis.__require
  if (typeof __require === 'function') {
    const moduleRegistry = __require.cache || (__require.resolve && {})
    if (moduleRegistry) {
      moduleRegistry['node:os'] = { exports: osShim }
      moduleRegistry['os'] = { exports: osShim }
    }
  }
} catch {
  /* ignore — fallback below */
}

// Also expose on globalThis as a fallback
;(globalThis as Record<string, unknown>).__OS_SHIM__ = osShim

// Some bundlers honor this pattern — declare `os` as a global
try {
  // @ts-expect-error — augmenting global
  if (!globalThis.os) globalThis.os = osShim
} catch {
  /* ignore */
}

// ───────────────────────────────────────────────────────────────────
// 3. Mark polyfill as applied
// ───────────────────────────────────────────────────────────────────
;(globalThis as Record<string, unknown>).__NODE_POLYFILL_APPLIED = true

// Re-export os shim so it can be imported directly if needed
export { osShim }
