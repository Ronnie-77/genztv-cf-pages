// ═══════════════════════════════════════════════════════════════════
// Patch Prisma runtime to replace node: built-ins with inline shims
// ═══════════════════════════════════════════════════════════════════
//
// Targeted patch — ONLY patches the specific files that:
//   1. Are imported by the worker bundle (via @prisma/client or @prisma/adapter-d1)
//   2. Contain module-level node:fs/node:os/node:child_process imports
//
// Does NOT patch query engine detection code (binary.mjs, get-platform, etc.)
// which legitimately needs real os/platform info during local dev.
//
// Target files:
//   - @prisma/client/runtime/library.mjs  (main runtime, imported by worker)
//   - @prisma/adapter-d1/dist/index-node.mjs (D1 adapter node entry)
//
// Run after `prisma generate`. Idempotent.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// Target files (only these — don't touch engine detection code)
const targetFiles = [
  // Prisma client runtime library
  'node_modules/@prisma/client/runtime/library.mjs',
  // D1 adapter node entry (imports node:fs)
  'node_modules/@prisma/adapter-d1/dist/index-node.mjs',
  // Prisma client main entry (may import library)
  'node_modules/@prisma/client/client.mjs',
]

// ── Inline stub objects ──────────────────────────────────────────
const osStub = `({EOL:"\\n",arch:()=>"x64",platform:()=>"linux",hostname:()=>"cf",tmpdir:()=>"",homedir:()=>"",type:()=>"Linux",release:()=>"0",uptime:()=>0,loadavg:()=>[0,0,0],totalmem:()=>0,freemem:()=>0,cpus:()=>[],networkInterfaces:()=>({}),endianness:()=>"LE",availableParallelism:()=>1,constants:{}})`

const fsStub = `({readdirSync:()=>[],existsSync:()=>false,statSync:()=>({isFile:()=>false,isDirectory:()=>false,size:0}),readFileSync:()=>"",readFile:(p,o,cb)=>{typeof o==="function"?o(null,""):cb&&cb(null,"")},accessSync:()=>{},realpathSync:p=>p,writeFileSync:()=>{},mkdirSync:()=>{},readdir:(p,o,cb)=>{typeof o==="function"?o(null,[]):cb&&cb(null,[])},promises:{readFile:()=>Promise.resolve(""),readdir:()=>Promise.resolve([]),writeFile:()=>Promise.resolve(),mkdir:()=>Promise.resolve()}})`

const fsPromisesStub = `({readFile:()=>Promise.resolve(""),readdir:()=>Promise.resolve([]),writeFile:()=>Promise.resolve(),mkdir:()=>Promise.resolve(),stat:()=>Promise.resolve({isFile:()=>false,isDirectory:()=>false,size:0}),access:()=>Promise.resolve()})`

const cpStub = `({execSync:()=>"",exec:()=>{},spawn:()=>{throw new Error("disabled")},execFile:()=>{},fork:()=>{throw new Error("disabled")}})`

const utilStub = `({promisify:fn=>fn&&typeof fn==="function"?(...a)=>Promise.resolve(fn(...a)):()=>Promise.resolve(),inspect:v=>String(v),format:(...a)=>a.join(" "),callbackify:()=>()=>{}})`

// ── Apply replacements to a source string ────────────────────────
function applyPatches(src) {
  const original = src

  // 1. Replace dynamic require() calls (Prisma's internal `fr()` helper)
  src = src.replace(/fr\("node:os"\)/g, osStub)
  src = src.replace(/require\("node:os"\)/g, osStub)
  src = src.replace(/fr\("node:fs"\)/g, fsStub)
  src = src.replace(/require\("node:fs"\)/g, fsStub)
  src = src.replace(/fr\("node:child_process"\)/g, cpStub)
  src = src.replace(/require\("node:child_process"\)/g, cpStub)
  src = src.replace(/fr\("node:util"\)/g, utilStub)
  src = src.replace(/require\("node:util"\)/g, utilStub)

  // 2. Replace static ESM default imports
  src = src.replace(/import\s+(\w+)\s*from\s*"node:os"\s*;?/g, (_, name) => `var ${name}=${osStub};`)
  src = src.replace(/import\s+(\w+)\s*from\s*"node:fs"\s*;?/g, (_, name) => `var ${name}=${fsStub};`)
  src = src.replace(/import\s+(\w+)\s*from\s*"node:child_process"\s*;?/g, (_, name) => `var ${name}=${cpStub};`)
  src = src.replace(/import\s+(\w+)\s*from\s*"node:util"\s*;?/g, (_, name) => `var ${name}=${utilStub};`)
  src = src.replace(/import\s+(\w+)\s*from\s*"node:fs\/promises"\s*;?/g, (_, name) => `var ${name}=${fsPromisesStub};`)

  // 3. Replace named imports
  const namedImportReplacer = (stubName) => (_, names) => {
    return names.split(',').map((n) => {
      const m = n.trim().match(/(\w+)\s*(?:as\s+(\w+))?/)
      if (!m) return ''
      const [, imp, local] = m
      const target = local || imp
      return `var ${target}=${stubName}.${imp};`
    }).join('')
  }

  src = src.replace(/import\s*\{([^}]+)\}\s*from\s*"node:util"\s*;?/g, namedImportReplacer(utilStub))
  src = src.replace(/import\s*\{([^}]+)\}\s*from\s*"node:os"\s*;?/g, namedImportReplacer(osStub))
  src = src.replace(/import\s*\{([^}]+)\}\s*from\s*"node:fs"\s*;?/g, namedImportReplacer(fsStub))
  src = src.replace(/import\s*\{([^}]+)\}\s*from\s*"node:child_process"\s*;?/g, namedImportReplacer(cpStub))

  // 4. Replace `import * as X from "node:fs"`
  src = src.replace(/import\s*\*\s*as\s+(\w+)\s*from\s*"node:os"\s*;?/g, (_, name) => `var ${name}=${osStub};`)
  src = src.replace(/import\s*\*\s*as\s+(\w+)\s*from\s*"node:fs"\s*;?/g, (_, name) => `var ${name}=${fsStub};`)
  src = src.replace(/import\s*\*\s*as\s+(\w+)\s*from\s*"node:child_process"\s*;?/g, (_, name) => `var ${name}=${cpStub};`)
  src = src.replace(/import\s*\*\s*as\s+(\w+)\s*from\s*"node:util"\s*;?/g, (_, name) => `var ${name}=${utilStub};`)

  // 5. Side-effect-only imports
  src = src.replace(/import\s*"node:os"\s*;?/g, '')
  src = src.replace(/import\s*"node:fs"\s*;?/g, '')

  return src !== original ? src : null
}

// ── Main ────────────────────────────────────────────────────────
let patchedCount = 0
let scannedCount = 0

for (const relPath of targetFiles) {
  // Try both project root and cwd
  for (const base of [projectRoot, process.cwd()]) {
    const filePath = resolve(base, relPath)
    if (!existsSync(filePath)) continue

    scannedCount++
    let src
    try {
      src = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }

    // Only patch if the file contains node: imports we care about
    if (!/node:(fs|os|child_process|util)/.test(src)) continue

    const patched = applyPatches(src)
    if (patched) {
      writeFileSync(filePath, patched)
      const display = filePath.replace(projectRoot + '/', '').replace(process.cwd() + '/', '')
      console.log(`[patch-prisma] ✅ Patched ${display}`)
      patchedCount++
    } else {
      const display = filePath.replace(projectRoot + '/', '').replace(process.cwd() + '/', '')
      console.log(`[patch-prisma] No changes: ${display}`)
    }
    break // found at this base, don't check the other
  }
}

console.log(`[patch-prisma] Scanned ${scannedCount} target file(s), patched ${patchedCount}.`)
