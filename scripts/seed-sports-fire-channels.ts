/**
 * Seed script: Add 10 sports channels extracted from sports-fire.lovable.app
 *
 * Architecture of sports-fire.lovable.app (Lovable SPA):
 *   - All channels are hardcoded in the JS bundle as `kp=[{id, name, logo, group, quality, url}, ...]`
 *   - Streams are MPEG-TS live streams (.ts extension) hosted on rgkkw.live and starhub.pro
 *   - Played with `mpegts.js` library, proxied through `/api/proxy?url=...` for CORS
 *
 * Our project already has:
 *   - TsPlayer component (mpegts.js-based) ✓
 *   - stream-proxy API that pipes live .ts streams incrementally ✓
 *   - Player auto-detects .ts URLs and routes to TsPlayer ✓
 *   - One channel already using starhub.pro (Football World Cup 2026 (4K) 2 — 745269.ts)
 *
 * This script adds the remaining 10 channels (skipping 745269.ts which already exists).
 *
 * Source: https://sports-fire.lovable.app/assets/index-Dx64dbZS.js
 *         (extracted via Agent Browser network inspection + JS bundle parsing)
 */

import { db } from '@/lib/db'

interface SeedChannel {
  name: string
  logo: string
  group: string
  quality: string
  url: string
}

// Channels extracted from sports-fire.lovable.app JS bundle
// (la5liga.store channels skipped — Cloudflare-protected, 403 on direct access)
const channels: SeedChannel[] = [
  {
    name: 'T Sports HD 1',
    logo: 'https://i.ibb.co.com/h1Wvy09C/1000283988.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/130714.ts',
  },
  {
    name: 'T Sports HD 2',
    logo: 'https://i.ibb.co.com/h1Wvy09C/1000283988.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/130714.ts',
  },
  {
    name: 'UNITE8 SPORTS 1',
    logo: 'https://i.ibb.co/k6KQwhFN/1000284104.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/741567.ts',
  },
  {
    name: 'UNITE8 SPORTS 2',
    logo: 'https://i.ibb.co/S4DXyQkZ/1000284105.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/98841.ts',
  },
  {
    name: 'beIN Sports 1 Max',
    logo: 'https://i.ibb.co/mCFTjfx6/1000284328.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/744523.ts',
  },
  {
    name: 'beIN Sports 2 Max',
    logo: 'https://i.ibb.co/4ZLsq041/1000284329.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/744524.ts',
  },
  {
    name: 'beIN Sports 5 Max',
    logo: 'https://i.ibb.co/JWVj7khh/1000284377.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/744527.ts',
  },
  {
    name: 'FUSSBALL TV1',
    logo: 'https://i.ibb.co.com/nMBnLS9h/1000284536.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/742610.ts',
  },
  {
    name: 'FUSSBALL TV2',
    logo: 'https://i.ibb.co.com/TD6fkDPj/1000284537.png',
    group: 'FIFA',
    quality: 'HD',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/742611.ts',
  },
  {
    name: 'NOW TV 4K',
    logo: 'https://i.ibb.co/C32Rhtff/1000284518.png',
    group: 'FIFA',
    quality: '4K',
    url: 'http://starhub.pro/live/farhat-3379/67897-913379/745270.ts',
  },
]

async function main() {
  console.log(`\n=== Seeding ${channels.length} sports channels from sports-fire.lovable.app ===\n`)

  let added = 0
  let skipped = 0

  for (const ch of channels) {
    // Check if a channel with the same streamUrl already exists
    const existing = await db.channel.findFirst({
      where: { streamUrl: ch.url },
      select: { id: true, name: true },
    })

    if (existing) {
      console.log(`SKIP  (already exists): ${ch.name}  →  ${existing.name} (${existing.id})`)
      skipped++
      continue
    }

    // Create the channel
    const created = await db.channel.create({
      data: {
        name: ch.name,
        logo: ch.logo,
        category: 'sports,football', // multi-category: Sports + Football
        streamType: 'mpegts',        // routes through TsPlayer via stream-proxy
        streamUrl: ch.url,
        language: '',
        country: '',
        tags: [ch.group, ch.quality, 'FIFA', 'live'].filter(Boolean).join(','),
        isFeatured: false,
        isActive: true,
      },
    })

    console.log(`ADDED ${ch.name.padEnd(22)} [${ch.quality.padEnd(3)}] ${ch.url}`)
    added++
  }

  console.log(`\n=== Done: ${added} added, ${skipped} skipped (already existed) ===\n`)

  // Show final count of sports channels
  const sportsCount = await db.channel.count({
    where: { category: { contains: 'sports' } },
  })
  console.log(`Total sports-category channels now: ${sportsCount}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
