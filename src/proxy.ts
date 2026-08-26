import { NextRequest, NextResponse } from 'next/server'

// ─── Rate Limiting (in-memory) ───
const rateLimitMap = new Map<string, { count: number; lastReset: number }>()
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
const RATE_LIMIT_MAX = 100 // requests per window

// ─── Blocked User Agents (bots, scanners) ───
const BLOCKED_USER_AGENTS = [
  'sqlmap',
  'nikto',
  'nmap',
  'masscan',
  'dirbuster',
  'gobuster',
  'wfuzz',
  'burpsuite',
  'zap',
  'arachni',
  'w3af',
  'acunetix',
  'nessus',
  'openvas',
  'metasploit',
  'hydra',
  'medusa',
  'john',
  'curl/',
  'wget/',
  'python-requests',
  'httpclient',
  'scanner',
]

// ─── Suspicious paths (common attack vectors) ───
const BLOCKED_PATHS = [
  '/.env',
  '/.git',
  '/.ssh',
  '/wp-admin',
  '/wp-login',
  '/wp-config',
  '/phpmyadmin',
  '/phpmy',
  '/admin/config',
  '/admin/login',
  '/xmlrpc.php',
  '/.htaccess',
  '/.htpasswd',
  '/config.php',
  '/database.yml',
  '/.DS_Store',
  '/composer.json',
  '/package.json',
  '/server-status',
  '/server-info',
  '/actuator',
  '/swagger',
  '/api-docs',
  '/graphql',
  '/.well-known/security.txt',
  '/debug',
  '/trace',
  '/console',
  '/shell',
  '/cmd',
  '/exec',
  '/eval',
]

// ─── Suspicious query patterns ───
const SQL_INJECTION_PATTERNS = [
  /(\bunion\b.*\bselect\b)/i,
  /(\bselect\b.*\bfrom\b)/i,
  /(\binsert\b.*\binto\b)/i,
  /(\bdelete\b.*\bfrom\b)/i,
  /(\bdrop\b.*\btable\b)/i,
  /(\balter\b.*\btable\b)/i,
  /(\bexec\b.*\()/i,
  /(<script\b)/i,
  /(javascript:)/i,
  /(\bon\w+\s*=)/i, // event handlers like onclick=
  /(\.\.\/)/, // path traversal
  /(\/etc\/passwd)/i,
  /(\/proc\/self)/i,
]

// ─── Main proxy handler ───
// Exported as both named (`proxy`) and default for maximum compatibility.
// Next.js 16's middleware template resolves the handler via:
//   (isProxy ? mod.proxy : mod.middleware) || mod.default
// Providing a default export ensures the handler is found even if the
// compiled template mis-detects the file type (e.g. stale .next cache),
// which otherwise causes "adapterFn is not a function" runtime errors.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const userAgent = request.headers.get('user-agent') || ''
  const ip = request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown'

  // ─── 1. Block suspicious paths ───
  for (const blocked of BLOCKED_PATHS) {
    if (pathname.toLowerCase().startsWith(blocked)) {
      return new NextResponse(null, { status: 404 })
    }
  }

  // ─── 2. Block suspicious user agents ───
  const lowerUA = userAgent.toLowerCase()
  for (const blocked of BLOCKED_USER_AGENTS) {
    if (lowerUA.includes(blocked)) {
      return new NextResponse(null, { status: 403 })
    }
  }

  // ─── 3. Block SQL injection / XSS in query params ───
  const fullUrl = pathname + search
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(fullUrl)) {
      return new NextResponse(null, { status: 400 })
    }
  }

  // ─── 4. Rate limiting ───
  const now = Date.now()
  const rateInfo = rateLimitMap.get(ip)

  if (!rateInfo || now - rateInfo.lastReset > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, lastReset: now })
  } else {
    rateInfo.count++
    if (rateInfo.count > RATE_LIMIT_MAX) {
      return new NextResponse('Too Many Requests', { status: 429 })
    }
  }

  // ─── 5. Clean up old rate limit entries (prevent memory leak) ───
  if (Math.random() < 0.01) { // 1% chance on each request
    for (const [key, value] of rateLimitMap.entries()) {
      if (now - value.lastReset > RATE_LIMIT_WINDOW * 2) {
        rateLimitMap.delete(key)
      }
    }
  }

  // ─── 6. Add security headers to response ───
  const response = NextResponse.next()

  // Remove server identifying headers
  response.headers.delete('X-Powered-By')
  response.headers.delete('Server')

  // Add cache control for sensitive pages
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/api/admin')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
  }

  return response
}

// Default export — safety net for stale .next caches / Turbopack edge cases
export default proxy

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, etc.
     */
    '/((?!_next/static|_next/image|favicon\\.svg|favicon-dark\\.svg|logo\\.svg|manifest\\.json|sw\\.js|robots\\.txt).*)',
  ],
}
