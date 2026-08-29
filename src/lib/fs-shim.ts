// ═══════════════════════════════════════════════════════════════════
// fs shim — drop-in replacement for Node's `fs` module
// ═══════════════════════════════════════════════════════════════════
//
// This file is used as a Turbopack alias target for `node:fs`.
// It provides stub implementations of all fs functions that Prisma's
// runtime might call during client init. With a D1 driver adapter,
// the query engine binary is never used — these stubs only satisfy
// the module-level detection code path.

export const readdirSync = (): string[] => []

export const existsSync = (): boolean => false

export const statSync = () => ({
  isFile: () => false,
  isDirectory: () => false,
  isSymbolicLink: () => false,
  size: 0,
  mtime: new Date(0),
  ctime: new Date(0),
  birthtime: new Date(0),
})

export const lstatSync = () => ({
  isFile: () => false,
  isDirectory: () => false,
  isSymbolicLink: () => false,
  size: 0,
})

export const readFileSync = (): string => ''

export const readFile = (
  _path: string,
  _opts: unknown,
  cb?: (err: Error | null, result?: unknown) => void
): void => {
  if (typeof _opts === 'function' && cb === undefined) cb = _opts as typeof cb
  if (cb) cb(null, '')
}

export const accessSync = (): void => {}

export const realpathSync = (p: string): string => p

export const writeFileSync = (): void => {}
export const mkdirSync = (): void => {}

export const readdir = (
  _path: string,
  _opts: unknown,
  cb?: (err: Error | null, result?: unknown) => void
): void => {
  if (typeof _opts === 'function' && cb === undefined) cb = _opts as typeof cb
  if (cb) cb(null, [])
}

export const promises = {
  readFile: () => Promise.resolve(''),
  readdir: () => Promise.resolve([]),
  writeFile: () => Promise.resolve(),
  mkdir: () => Promise.resolve(),
  stat: () => Promise.resolve({ isFile: () => false, isDirectory: () => false, size: 0 }),
  access: () => Promise.resolve(),
}

export const constants = {
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  F_OK: 0,
}

// Default export
export default {
  readdirSync,
  existsSync,
  statSync,
  lstatSync,
  readFileSync,
  readFile,
  accessSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
  readdir,
  promises,
  constants,
}
