// ═══════════════════════════════════════════════════════════════════
// Patch Prisma runtime to replace node: built-ins with inline shims
// ═══════════════════════════════════════════════════════════════════
//
// Prisma's `@prisma/client/runtime/library.mjs` uses STATIC ESM imports:
//   import Ru from "node:fs";
//   import ni from "node:os";
//   import ku from "node:child_process";
//   import { promisify as _u } from "node:util";
//
// On Cloudflare Workers (workerd runtime), `node:os` / `node:fs` /
// `node:child_process` are NOT resolvable even with `nodejs_compat`.
// Only some functions exist via unenv, but the module import itself fails
// with "No such module node:os".
//
// This script rewrites those static imports into inline stub objects so
// the worker bundle has no external `node:*` imports to resolve.
//
// Run after `prisma generate` (e.g. in postinstall). Idempotent.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

const candidates = [
  resolve(projectRoot, 'node_modules/@prisma/client/runtime/library.mjs'),
  resolve(projectRoot, 'node_modules/.prisma/client/runtime/library.mjs'),
  resolve(process.cwd(), 'node_modules/@prisma/client/runtime/library.mjs'),
  resolve(process.cwd(), 'node_modules/.prisma/client/runtime/library.mjs'),
  // Also patch @prisma/adapter-d1's node entry (it imports node:fs)
  resolve(projectRoot, 'node_modules/@prisma/adapter-d1/dist/index-node.mjs'),
  resolve(process.cwd(), 'node_modules/@prisma/adapter-d1/dist/index-node.mjs'),
]

let patchedCount = 0
for (const libPath of candidates) {
  if (!existsSync(libPath)) continue
  console.log(`[patch-prisma] Patching ${libPath}`)

let src = readFileSync(libPath, 'utf8')
const original = src

// ── Inline stub objects ──────────────────────────────────────────
// Provide the minimum API surface Prisma's init/detection code uses.
// The D1 driver adapter never invokes the query engine binary — these
// stubs only satisfy the module-level detection code paths.

const osStub = `({EOL:"\\n",arch:()=>"x64",platform:()=>"linux",hostname:()=>"cf",tmpdir:()=>"",homedir:()=>"",type:()=>"Linux",release:()=>"0",uptime:()=>0,loadavg:()=>[0,0,0],totalmem:()=>0,freemem:()=>0,cpus:()=>[],networkInterfaces:()=>({}),endianness:()=>"LE",availableParallelism:()=>1,constants:{}})`

const fsStub = `({readdirSync:()=>[],existsSync:()=>false,statSync:()=>({isFile:()=>false,isDirectory:()=>false,size:0}),readFileSync:()=>"",readFile:(p,o,cb)=>{typeof o==="function"?o(null,""):cb&&cb(null,"")},accessSync:()=>{},realpathSync:p=>p,writeFileSync:()=>{},mkdirSync:()=>{},readdir:(p,o,cb)=>{typeof o==="function"?o(null,[]):cb&&cb(null,[])},promises:{readFile:()=>Promise.resolve(""),readdir:()=>Promise.resolve([]),writeFile:()=>Promise.resolve(),mkdir:()=>Promise.resolve()}})`

const fsPromisesStub = `({readFile:()=>Promise.resolve(""),readdir:()=>Promise.resolve([]),writeFile:()=>Promise.resolve(),mkdir:()=>Promise.resolve(),stat:()=>Promise.resolve({isFile:()=>false,isDirectory:()=>false,size:0}),access:()=>Promise.resolve()})`

const cpStub = `({execSync:()=>"",exec:()=>{},spawn:()=>{throw new Error("disabled")},execFile:()=>{},fork:()=>{throw new Error("disabled")}})`

const utilStub = `({promisify:fn=>fn&&typeof fn==="function"?(...a)=>Promise.resolve(fn(...a)):()=>Promise.resolve(),inspect:v=>String(v),format:(...a)=>a.join(" "),callbackify:()=>()=>{}})`

// ── 1. Replace dynamic require() calls ───────────────────────────
src = src.replace(/fr\("node:os"\)/g, osStub)
src = src.replace(/require\("node:os"\)/g, osStub)
src = src.replace(/fr\("node:fs"\)/g, fsStub)
src = src.replace(/require\("node:fs"\)/g, fsStub)
src = src.replace(/fr\("node:child_process"\)/g, cpStub)
src = src.replace(/require\("node:child_process"\)/g, cpStub)

// ── 2. Replace static ESM imports (default + named) ──────────────
// Handles both `import X from "node:os"` AND `import X from"node:os"` (no space — minified)
src = src.replace(
  /import\s+(\w+)\s*from\s*"node:os"\s*;?/g,
  (_, name) => `var ${name}=${osStub};`
)
src = src.replace(
  /import\s+(\w+)\s*from\s*"node:fs"\s*;?/g,
  (_, name) => `var ${name}=${fsStub};`
)
src = src.replace(
  /import\s+(\w+)\s*from\s*"node:child_process"\s*;?/g,
  (_, name) => `var ${name}=${cpStub};`
)
src = src.replace(
  /import\s+(\w+)\s*from\s*"node:util"\s*;?/g,
  (_, name) => `var ${name}=${utilStub};`
)
src = src.replace(
  /import\s+(\w+)\s*from\s*"node:fs\/promises"\s*;?/g,
  (_, name) => `var ${name}=${fsPromisesStub};`
)

// Named imports: `import { promisify as _u } from "node:util";` or minified `import{X as Y}from"node:util"`
src = src.replace(
  /import\s*\{([^}]+)\}\s*from\s*"node:util"\s*;?/g,
  (_, names) => {
    return names
      .split(',')
      .map((n) => {
        const m = n.trim().match(/(\w+)\s*(?:as\s+(\w+))?/)
        if (!m) return ''
        const [, imp, local] = m
        const target = local || imp
        return `var ${target}=${utilStub}.${imp};`
      })
      .join('')
  }
)

src = src.replace(
  /import\s*\{([^}]+)\}\s*from\s*"node:os"\s*;?/g,
  (_, names) => {
    return names
      .split(',')
      .map((n) => {
        const m = n.trim().match(/(\w+)\s*(?:as\s+(\w+))?/)
        if (!m) return ''
        const [, imp, local] = m
        const target = local || imp
        return `var ${target}=${osStub}.${imp};`
      })
      .join('')
  }
)

src = src.replace(
  /import\s*\{([^}]+)\}\s*from\s*"node:fs"\s*;?/g,
  (_, names) => {
    return names
      .split(',')
      .map((n) => {
        const m = n.trim().match(/(\w+)\s*(?:as\s+(\w+))?/)
        if (!m) return ''
        const [, imp, local] = m
        const target = local || imp
        return `var ${target}=${fsStub}.${imp};`
      })
      .join('')
  }
)

// ── 3. Replace `import "node:os"` (side-effect only) ─────────────
src = src.replace(/import\s*"node:os"\s*;?/g, '')
src = src.replace(/import\s*"node:fs"\s*;?/g, '')

if (src !== original) {
  writeFileSync(libPath, src)
  console.log('[patch-prisma] ✅ Patched successfully.')
  patchedCount++
} else {
  console.log('[patch-prisma] No changes (already patched or patterns not found).')
}
} // end for loop

console.log(`[patch-prisma] Done. Patched ${patchedCount} file(s).`)
