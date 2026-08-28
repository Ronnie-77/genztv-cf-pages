// ═══════════════════════════════════════════════════════════════════
// Node.js polyfills for Cloudflare Workers
// ═══════════════════════════════════════════════════════════════════
//
// On Cloudflare Workers (workerd runtime), `node:fs` and `node:os`
// are NOT resolvable as modules even with nodejs_compat — importing
// them at the top level causes "No such module" errors at runtime.
//
// This file provides stubs WITHOUT importing node:fs/node:os. Instead,
// it lazily attempts to access the modules via a dynamic require (which
// fails gracefully on Workers) and falls back to in-memory stubs.
//
// Prisma's runtime calls fs.readdirSync, os.platform(), etc. during
// client init for engine detection. With a D1 driver adapter, the
// engine binary is never actually used — so stubs are safe.
// ═══════════════════════════════════════════════════════════════════

type Callback = (err: Error | null, result?: unknown) => void

// ── fs stub ──────────────────────────────────────────────────────
const fsStub = {
  readdirSync: (): string[] => [],
  readdir: (_path: string, _opts: unknown, cb?: Callback): void => {
    if (typeof _opts === 'function' && cb === undefined) cb = _opts
    if (cb) cb(null, [])
  },
  existsSync: (): boolean => false,
  statSync: (): object => ({
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size: 0,
    mtime: new Date(0),
    ctime: new Date(0),
    birthtime: new Date(0),
  }),
  lstatSync: (): object => ({
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size: 0,
  }),
  readFile: (_p: string, _o: unknown, cb?: Callback): void => {
    if (typeof _o === 'function' && cb === undefined) cb = _o
    if (cb) cb(null, '')
  },
  readFileSync: (): string => '',
  accessSync: (): void => {},
  realpathSync: (p: string): string => p,
  writeFileSync: (): void => {},
  mkdirSync: (): void => {},
  promises: {
    readFile: () => Promise.resolve(''),
    readdir: () => Promise.resolve([]),
    writeFile: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    stat: () => Promise.resolve({ isFile: () => false, isDirectory: () => false, size: 0 }),
    access: () => Promise.resolve(),
  },
}

// ── os stub ──────────────────────────────────────────────────────
const osStub = {
  EOL: '\n',
  arch: () => 'x64',
  platform: () => 'linux',
  hostname: () => 'cloudflare-workers',
  tmpdir: () => '/tmp',
  homedir: () => '/tmp',
  userinfo: () => ({ username: 'worker', uid: 0, gid: 0, shell: null, homedir: '/tmp' }),
  type: () => 'Linux',
  release: () => '0.0.0',
  uptime: () => 0,
  loadavg: () => [0, 0, 0],
  totalmem: () => 1024 * 1024 * 1024,
  freemem: () => 512 * 1024 * 1024,
  cpus: () => [{ model: 'Cloudflare Worker', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
  networkInterfaces: () => ({}),
  getNetworkInterfaces: () => ({}),
  endianness: () => 'LE' as 'LE' | 'BE',
  availableParallelism: () => 1,
  constants: { UV_UDP_REUSEADDR: 0, signals: {}, errno: {}, dlopen: {}, priority: {} },
}

// ── Install stubs on globalThis ──────────────────────────────────
// We register these as the `fs` and `os` modules on a global module
// cache, so that any code doing `require('node:fs')` or accessing
// `globalThis.fs` gets our stubs. Direct ESM `import 'node:fs'` is
// handled by patching Prisma's library.mjs (see scripts/patch-prisma.mjs).
;(globalThis as Record<string, unknown>).__fsStub = fsStub
;(globalThis as Record<string, unknown>).__osStub = osStub

// Try to register with the module system if a require function exists
try {
  // @ts-expect-error — unenv's internal require cache
  const __require = (globalThis as Record<string, unknown>).require as
    | ((m: string) => unknown) & { cache?: Record<string, unknown> }
    | undefined
  if (__require && __require.cache) {
    __require.cache['node:fs'] = { exports: fsStub }
    __require.cache['node:os'] = { exports: osStub }
    __require.cache['fs'] = { exports: fsStub }
    __require.cache['os'] = { exports: osStub }
  }
} catch {
  // ignore — dynamic require not available
}

// Also expose on globalThis as fallback
try {
  if (!(globalThis as Record<string, unknown>).fs) {
    ;(globalThis as Record<string, unknown>).fs = fsStub
  }
  if (!(globalThis as Record<string, unknown>).os) {
    ;(globalThis as Record<string, unknown>).os = osStub
  }
} catch {
  // ignore
}

;(globalThis as Record<string, unknown>).__NODE_POLYFILL_APPLIED = true
