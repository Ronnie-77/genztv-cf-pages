import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'

interface ParsedChannel {
  name: string
  logo: string
  group: string
  url: string
  language?: string
  country?: string
  streamType?: string  // 🎯🛡️ allow JSON to specify 'm3u8_direct' / 'm3u8_proxy' / etc.
}

// ── URL-based stream type auto-detection ────────────────────────────────────
// Used when the JSON doesn't explicitly declare a `streamType` (or declares an
// unknown one). This prevents the misclassification bugs where:
//   • .m3u8 URLs were falling into the iframe bucket (because no type matched)
//   • .ts  URLs were falling into the m3u8 bucket (same reason)
//
// Detection order matters:
//   1. .ts  extension           → 'mpegts'
//   2. .m3u8 / .m3u extension   → 'm3u8' (default HLS; StreamPlayer treats it as direct)
//   3. .mpd extension           → 'dash' (MPEG-DASH manifest, handled by dash.js)
//   4. iframe/embed patterns    → 'iframe'
//   5. everything else          → undefined (let the frontend decide / show error)
function detectStreamTypeFromUrl(url: string): string | undefined {
  if (!url) return undefined
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    // not an absolute URL — use as-is
  }
  // Raw MPEG-TS segment (.ts). Must come BEFORE the .m3u8 check because some
  // weird URLs could theoretically contain both, and a .ts file is never an m3u8.
  if (/\.ts(\?.*)?$/i.test(pathname)) {
    return 'mpegts'
  }
  // HLS manifest
  if (/\.m3u8?(\?.*)?$/i.test(pathname)) {
    return 'm3u8'
  }
  // DASH manifest (.mpd)
  if (/\.mpd(\?.*)?$/i.test(pathname)) {
    return 'dash'
  }
  // Common iframe/embed hosts — treat as iframe embeds
  if (/(?:youtube\.com\/embed|youtu\.be|player\.twitch\.tv|player\.vimeo\.com|dailymotion\.com\/embed|facebook\.com\/plugins\/video|iframe\.|\/embed\/)/i.test(url)) {
    return 'iframe'
  }
  // GitHub-hosted .m3u (raw or blob URL)
  if (/github\.com\/.*\.m3u/i.test(url) || /raw\.githubusercontent\.com\/.*\.m3u/i.test(url)) {
    return 'github_m3u'
  }
  return undefined
}

// POST /api/channels/import-file — parse uploaded .m3u or .json file content
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const body = await req.json()
      const { content, fileType } = body as { content: string; fileType: string }

      if (!content || !fileType) {
        return NextResponse.json({ error: 'File content and type are required' }, { status: 400 })
      }

      let channels: ParsedChannel[] = []

      if (fileType === 'm3u') {
        channels = parseM3UContent(content)
      } else if (fileType === 'json') {
        channels = parseJSONContent(content)
      } else {
        return NextResponse.json({ error: 'Unsupported file type. Use .m3u or .json' }, { status: 400 })
      }

      return NextResponse.json({ channels, total: channels.length })
    } catch (error) {
      console.error('Error parsing import file:', error)
      return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 })
    }
  })
}

function parseM3UContent(content: string): ParsedChannel[] {
  const channels: ParsedChannel[] = []
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)

  let currentName = ''
  let currentLogo = ''
  let currentGroup = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/)
      currentName = nameMatch ? nameMatch[1].trim() : 'Unknown Channel'

      const logoMatch = line.match(/tvg-logo="([^"]*)"/)
      currentLogo = logoMatch ? logoMatch[1] : ''

      const groupMatch = line.match(/group-title="([^"]*)"/)
      currentGroup = groupMatch ? groupMatch[1] : ''

      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]
        if (!nextLine.startsWith('#')) {
          channels.push({
            name: currentName,
            logo: currentLogo,
            group: currentGroup,
            url: nextLine,
            streamType: detectStreamTypeFromUrl(nextLine),
          })
          break
        }
      }
    }
  }

  return channels
}

function parseJSONContent(content: string): ParsedChannel[] {
  const channels: ParsedChannel[] = []

  try {
    const parsed = JSON.parse(content)

    // Support various JSON formats
    let items: unknown[] = []

    if (Array.isArray(parsed)) {
      // Direct array of channel objects
      items = parsed
    } else if (parsed && typeof parsed === 'object') {
      // Object with channels array
      if (Array.isArray(parsed.channels)) {
        items = parsed.channels
      } else if (Array.isArray(parsed.data)) {
        items = parsed.data
      } else if (parsed.exportData && Array.isArray(parsed.exportData.channels)) {
        // GenZTV export format
        items = parsed.exportData.channels
      }
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') continue

      const obj = item as Record<string, unknown>

      // Map common field names to our format
      const name = String(obj.name || obj.title || obj.channel_name || obj.channelName || 'Unknown Channel')
      const logo = String(obj.logo || obj.logo_url || obj.logoUrl || obj.image || obj.icon || obj.tvg_logo || '')
      const group = String(obj.group || obj.group_title || obj.groupTitle || obj.category || obj.categories || '')
      const url = String(obj.url || obj.stream_url || obj.streamUrl || obj.stream || obj.link || '')
      const language = String(obj.language || obj.lang || '')
      const country = String(obj.country || obj.region || '')
      // 🎯🛡️ streamType — let JSON specify which dedicated player to use.
      // NOTE: we deliberately do NOT read `obj.type` here — too many JSON
      // exports use `type` for unrelated metadata ("movie", "live", "tv",
      // "channel", etc.) which caused m3u8 URLs to be misclassified as iframe.
      const streamTypeRaw = String(obj.streamType || obj.stream_type || '').toLowerCase()
      const validStreamTypes = ['m3u', 'm3u8', 'm3u8_direct', 'm3u8_proxy', 'm3u8_jw', 'iframe', 'iframe_direct', 'mpegts', 'dash', 'github_m3u', 'direct', 'redirect']
      let streamType = validStreamTypes.includes(streamTypeRaw) ? streamTypeRaw : undefined

      // ── URL-based override (fixes remaining misclassification bugs) ──
      // Even when the JSON declares an explicit streamType, the URL is the
      // source of truth for .ts and .m3u8 files:
      //   • .ts URL  → ALWAYS 'mpegts' (regardless of declared type).
      //     A .ts file is never an iframe or m3u8 — it's a raw transport stream.
      //   • .m3u8 URL → if the declared type is 'iframe'/'redirect' (clearly
      //     wrong for an HLS manifest), override to 'm3u8'. But if the declared
      //     type is an HLS variant (m3u8_direct, m3u8_proxy, m3u8_jw), keep it —
      //     the user explicitly chose proxy vs direct.
      const urlDetected = detectStreamTypeFromUrl(url)
      if (urlDetected === 'mpegts') {
        // .ts URL always wins — force mpegts player
        streamType = 'mpegts'
      } else if (urlDetected === 'dash') {
        // .mpd URL always wins — force dash player (incompatible with hls.js)
        streamType = 'dash'
      } else if (urlDetected === 'm3u8' || urlDetected === 'm3u') {
        // .m3u8 URL — override clearly-wrong types (iframe/redirect/mpegts),
        // but preserve explicit HLS sub-types (m3u8_direct/m3u8_proxy/m3u8_jw)
        if (!streamType || streamType === 'iframe' || streamType === 'redirect' || streamType === 'mpegts' || streamType === 'iframe_direct') {
          streamType = 'm3u8'
        }
      } else if (!streamType) {
        // No explicit type and URL detection didn't match .ts/.m3u8 — use
        // whatever URL detection returned (iframe, github_m3u, or undefined)
        streamType = urlDetected
      }

      // Handle category as array or string
      let normalizedGroup = group
      if (Array.isArray(obj.category) || Array.isArray(obj.categories)) {
        const cats = (Array.isArray(obj.category) ? obj.category : obj.categories) as string[]
        normalizedGroup = cats.join(',')
      }

      // Only include if we have at least a name and url
      if (name && name !== 'Unknown Channel' && url) {
        channels.push({
          name,
          logo,
          group: normalizedGroup,
          url,
          language: language && language !== 'undefined' ? language : undefined,
          country: country && country !== 'undefined' ? country : undefined,
          streamType,
        })
      } else if (name && name !== 'Unknown Channel') {
        // Channel without URL — still include for user to see
        channels.push({
          name,
          logo,
          group: normalizedGroup,
          url,
          language: language && language !== 'undefined' ? language : undefined,
          country: country && country !== 'undefined' ? country : undefined,
          streamType,
        })
      }
    }
  } catch {
    throw new Error('Invalid JSON format')
  }

  return channels
}
