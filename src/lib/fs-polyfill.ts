// ═══════════════════════════════════════════════════════════════════
// fs polyfill (legacy — kept for backwards compat, re-exports node-polyfill)
// ═══════════════════════════════════════════════════════════════════
//
// This file previously imported `node:fs` and patched its methods.
// On Cloudflare Workers, importing `node:fs` at module level causes
// "No such module" errors. The actual stubs now live in
// `node-polyfill.ts` (without importing node:fs). This file just
// re-exports it so existing imports keep working.

export {}
