// ============================================================
//  Next.js API Route — Streaming Proxy
//  ফাইল: src/app/api/stream/route.ts
//  কাজ: CORS/Referer ব্লক থাকা CDN থেকে m3u8/ts স্ট্রিম প্রক্সি করে
// ============================================================

import { NextRequest, NextResponse } from 'next/server'

// প্রতিটি চ্যানেলের জন্য আপস্ট্রিম কনফিগ
// (অ্যাডমিন প্যানেল থেকেও এই ম্যাপ populate করা যায়)
const CHANNEL_CONFIG: Record<string, {
  upstream: string
  referer: string
  userAgent: string
}> = {
  'fifa-2026-server1': {
    upstream: 'https://prod-cdn01-live.toffeelive.com',
    referer: 'https://fifalive.click/',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  'argentina-vs-austria': {
    upstream: 'https://lb11.strmd.st',
    referer: 'https://embed.st/',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  'dulo-live': {
    upstream: 'https://dulo.tv',
    referer: 'https://dulo.tv/',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
}

export async function GET(req: NextRequest) {
  // ফ্রন্টএন্ড কল করবে:
  //   /api/stream?channel=argentina-vs-austria&path=/secure/.../playlist.m3u8
  const channel = req.nextUrl.searchParams.get('channel')
  const path = req.nextUrl.searchParams.get('path')

  if (!channel || !path) {
    return NextResponse.json(
      { error: 'channel ও path parameter দরকার' },
      { status: 400 }
    )
  }

  const config = CHANNEL_CONFIG[channel]
  if (!config) {
    return NextResponse.json(
      { error: `চ্যানেল '${channel}' কনফিগার করা নেই` },
      { status: 404 }
    )
  }

  const upstreamUrl = `${config.upstream}${path}`

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'Referer': config.referer,
        'User-Agent': config.userAgent,
        'Origin': config.referer.replace(/\/$/, ''),
      },
    })

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}`, url: upstreamUrl },
        { status: upstream.status }
      )
    }

    const body = await upstream.text()

    // যদি এটা master বা media playlist হয়, ভেতরের .ts/.m3u8 URL গুলোকে
    // আবার আমাদের প্রক্সি দিয়ে পাঠাতে হবে (rewrite)
    const rewritten = rewritePlaylist(body, channel, config.upstream)

    const contentType = upstream.headers.get('content-type')
      || (path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl'
          : path.endsWith('.ts')  ? 'video/mp2t'
          : 'application/octet-stream')

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'প্রক্সি ব্যর্থ', detail: err?.message },
      { status: 502 }
    )
  }
}

// ------------------------------------------------------------
//  m3u8 প্লেলিস্ট রিরাইট — ভেতরের URL গুলো প্রক্সি দিয়ে পাঠায়
// ------------------------------------------------------------
function rewritePlaylist(body: string, channel: string, upstream: string): string {
  // পরম URL (https://...) এবং আপেক্ষিক URL দুটোই হ্যান্ডেল করে
  return body
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      // URI="..." অ্যাট্রিবিউট (#EXT-X-KEY, #EXT-X-MAP ইত্যাদি)
      if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
        return rewriteUriAttribute(trimmed, channel, upstream)
      }
      // সাধারণ URL লাইন
      if (trimmed && !trimmed.startsWith('#')) {
        const abs = makeAbsolute(trimmed, upstream)
        return `/api/stream?channel=${channel}&path=${encodeURIComponent(abs.replace(upstream, ''))}`
      }
      return line
    })
    .join('\n')
}

function rewriteUriAttribute(line: string, channel: string, upstream: string): string {
  return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
    const abs = makeAbsolute(uri, upstream)
    const proxyPath = abs.replace(upstream, '')
    return `URI="/api/stream?channel=${channel}&path=${encodeURIComponent(proxyPath)}"`
  })
}

function makeAbsolute(url: string, base: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('//')) return 'https:' + url
  if (url.startsWith('/')) return base + url
  return base + '/' + url
}
