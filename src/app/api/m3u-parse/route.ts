import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'

// POST /api/m3u-parse — parse M3U content from URL (admin only)
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const body = await req.json()
      const url = body.url

      if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 })
      }

      // Convert GitHub URL to raw URL if needed
      let fetchUrl = url
      if (fetchUrl.includes('github.com') && !fetchUrl.includes('raw.githubusercontent.com')) {
        fetchUrl = fetchUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/')
      }

      const response = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'GenZ-TV/1.0' },
        signal: AbortSignal.timeout(15000),
      })

      if (!response.ok) {
        return NextResponse.json({ error: `Failed to fetch M3U: ${response.status}` }, { status: 400 })
      }

      const content = await response.text()
      const channels = parseM3U(content)

      return NextResponse.json({ channels, total: channels.length })
    } catch (error) {
      console.error('Error parsing M3U:', error)
      return NextResponse.json({ error: 'Failed to parse M3U file' }, { status: 500 })
    }
  })
}

interface M3UChannel {
  name: string
  logo: string
  group: string
  url: string
}

function parseM3U(content: string): M3UChannel[] {
  const channels: M3UChannel[] = []
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
          })
          break
        }
      }
    }
  }

  return channels
}
