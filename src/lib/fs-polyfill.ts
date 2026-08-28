// ═══════════════════════════════════════════════════════════════════
// fs polyfill for Cloudflare Workers
// ═══════════════════════════════════════════════════════════════════
//
// Cloudflare Workers (via unenv) provides a stubbed `fs` module, but
// `fs.readdir` / `fs.readdirSync` are NOT implemented. Prisma's
// `prisma-client-js` generator calls `fs.readdirSync` during client
// initialization to detect the query engine library — even when a
// driver adapter is used (the engine isn't needed for actual queries).
//
// This polyfill patches `fs.readdir` / `fs.readdirSync` to return an
// empty array, preventing the "[unenv] fs.readdir is not implemented
// yet!" crash. The D1 driver adapter handles all actual DB operations
// without needing the engine binary.
//
// Must be imported BEFORE @prisma/client in any module that uses Prisma.

import * as fs from 'node:fs'

type Callback = (err: NodeJS.ErrnoException | null, result?: unknown) => void

// Patch fs.readdir (callback version)
const originalReaddir = (fs as Record<string, unknown>).readdir
if (typeof originalReaddir !== 'function' || String(originalReaddir).includes('not implemented')) {
  ;(fs as Record<string, unknown>).readdir = function (
    _path: string,
    _options: unknown,
    callback?: Callback
  ): void {
    // Handle 2-arg variant: readdir(path, callback)
    if (typeof _options === 'function' && callback === undefined) {
      callback = _options as Callback
    }
    if (callback) callback(null, [])
  }
}

// Patch fs.readdirSync (sync version)
const originalReaddirSync = (fs as Record<string, unknown>).readdirSync
if (typeof originalReaddirSync !== 'function' || String(originalReaddirSync).includes('not implemented')) {
  ;(fs as Record<string, unknown>).readdirSync = function (_path: string): string[] {
    return []
  }
}

// Patch fs.existsSync (sometimes used by Prisma)
const originalExistsSync = (fs as Record<string, unknown>).existsSync
if (typeof originalExistsSync !== 'function' || String(originalExistsSync).includes('not implemented')) {
  ;(fs as Record<string, unknown>).existsSync = function (_path: string): boolean {
    return false
  }
}

// Patch fs.statSync
const originalStatSync = (fs as Record<string, unknown>).statSync
if (typeof originalStatSync !== 'function' || String(originalStatSync).includes('not implemented')) {
  ;(fs as Record<string, unknown>).statSync = function (_path: string): { isFile: () => boolean; isDirectory: () => boolean; size: number } {
    return {
      isFile: () => false,
      isDirectory: () => false,
      size: 0,
    }
  }
}

// Patch fs.lstatSync
const originalLstatSync = (fs as Record<string, unknown>).lstatSync
if (typeof originalLstatSync !== 'function' || String(originalLstatSync).includes('not implemented')) {
  ;(fs as Record<string, unknown>).lstatSync = function (_path: string): { isFile: () => boolean; isDirectory: () => boolean; size: number } {
    return {
      isFile: () => false,
      isDirectory: () => false,
      size: 0,
    }
  }
}

// Patch fs.readFile
const originalReadFile = (fs as Record<string, unknown>).readFile
if (typeof originalReadFile !== 'function' || String(originalReadFile).includes('not implemented')) {
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

// Patch fs.readFileSync
const originalReadFileSync = (fs as Record<string, unknown>).readFileSync
if (typeof originalReadFileSync !== 'function' || String(originalReadFileSync).includes('not implemented')) {
  ;(fs as Record<string, unknown>).readFileSync = function (_path: string): string {
    return ''
  }
}

// Patch fs.accessSync
const originalAccessSync = (fs as Record<string, unknown>).accessSync
if (typeof originalAccessSync !== 'function' || String(originalAccessSync).includes('not implemented')) {
  ;(fs as Record<string, unknown>).accessSync = function (): void {
    // no-op — pretend access is always granted
  }
}

// Mark as patched
;(globalThis as Record<string, unknown>).__FS_POLYFILL_APPLIED = true
