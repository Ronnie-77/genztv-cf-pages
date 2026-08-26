/**
 * Import script: Add FIFA 2026 live channels from fifalive.click/play
 *
 * Source: https://fifalive.click/play  (returns raw M3U playlist)
 * Format: HLS (.m3u8) — all 6 servers
 *
 * Stream classification (post-CORS test):
 *   - Server 1 (Toffeelive hdntl)         → m3u8_proxy  (Akamai signed token, expired)
 *   - Server 2 (tahmidx CF Worker)         → m3u8_direct (CORS-open *)
 *   - Server 3 (tahmidx-tsn CF Worker)     → m3u8_direct (CORS-open *)
 *   - Server 4 (inproviszon beinmax-5)     → m3u8_proxy  (DDoS-Guard, no ACAO)
 *   - Server 5 (tahmidx-tsn CF Worker 4K)  → m3u8_direct (CORS-open *, same URL as S3)
 *   - Server 6 (inproviszon tsn4k)         → m3u8_proxy  (DDoS-Guard, no ACAO)
 *
 * Idempotent: skips channels whose streamUrl already exists in DB.
 *
 * Run:  bun run scripts/import-fifalive.ts
 */

import { db } from '@/lib/db'

interface FifaChannel {
  name: string
  logo: string
  group: string
  streamType: string
  url: string
  language: string
  country: string
  note: string
}

const channels: FifaChannel[] = [
  {
    name: 'FIFA 2026 Live — Toffeelive (Server 1)',
    logo: '',
    group: 'sports',
    streamType: 'm3u8_proxy',
    url: 'https://prod-cdn01-live.toffeelive.com/live/FIFA-2026-4/0/master_2000.m3u8?hdntl=Expires=1782287049~_GO=Generated~URLPrefix=aHR0cHM6Ly9wcm9kLWNkbjAxLWxpdmUudG9mZmVlbGl2ZS5jb20~Signature=AVXEwveUIquATxp7U9qRWDundJ4tY6Wt81zwiUKg_M6cokQk8OcgXmtq_uOMonQKGDQFPN5DepdypBkfFM8grz63CDAP',
    language: 'multi',
    country: 'int',
    note: 'Akamai hdntl signed token — প্রক্সি দিয়ে চলবে; টোকেন মেয়াদ শেষ হলে https://fifalive.click/play থেকে নতুন URL আনুন',
  },
  {
    name: 'FIFA 2026 Live — Tahmidx Worker (Server 2)',
    logo: '',
    group: 'sports',
    streamType: 'm3u8_direct',
    url: 'https://tahmidx.dotreddigital.workers.dev/',
    language: 'multi',
    country: 'int',
    note: 'Cloudflare Worker HLS proxy — CORS-open (*), ডিরেক্ট প্লেয়ারে চলবে। Upstream: rockstreamer.com',
  },
  {
    name: 'FIFA 2026 Live — TSN Worker (Server 3)',
    logo: '',
    group: 'sports',
    streamType: 'm3u8_direct',
    url: 'https://tahmidx-tsn.dotreddigital.workers.dev/',
    language: 'multi',
    country: 'int',
    note: 'Cloudflare Worker HLS proxy — CORS-open (*), ডিরেক্ট প্লেয়ারে চলবে। Upstream: vishnu.indianservers.st',
  },
  {
    name: 'FIFA 2026 Live — beIN Max 5 (Server 4)',
    logo: '',
    group: 'sports',
    streamType: 'm3u8_proxy',
    url: 'https://inproviszon.st/beinmax-5.m3u8',
    language: 'multi',
    country: 'int',
    note: 'DDoS-Guard সুরক্ষিত — Referer/cookie দরকার, প্রক্সি দিয়ে চলবে',
  },
  {
    name: 'FIFA 2026 Live 4K — TSN Worker (Server 5)',
    logo: '',
    group: 'sports',
    streamType: 'm3u8_direct',
    url: 'https://tahmidx-tsn.dotreddigital.workers.dev/',
    language: 'multi',
    country: 'int',
    note: 'Server 3-এর সাথে একই URL (4K labeled) — CORS-open',
  },
  {
    name: 'FIFA 2026 Live 4K — TSN 4K (Server 6)',
    logo: '',
    group: 'sports',
    streamType: 'm3u8_proxy',
    url: 'https://inproviszon.st/tsn4k.m3u8',
    language: 'multi',
    country: 'int',
    note: 'DDoS-Guard সুরক্ষিত 4K — প্রক্সি দিয়ে চলবে',
  },
]

async function main() {
  console.log(`\n=== Importing ${channels.length} FIFA 2026 channels from fifalive.click/play ===\n`)

  let added = 0
  let skipped = 0

  for (const ch of channels) {
    // Idempotent: skip if same streamUrl already in DB
    const existing = await db.channel.findFirst({
      where: { streamUrl: ch.url },
      select: { id: true, name: true },
    })

    if (existing) {
      console.log(`SKIP  (already exists): ${ch.name}  →  ${existing.name} (${existing.id})`)
      skipped++
      continue
    }

    const created = await db.channel.create({
      data: {
        name: ch.name,
        logo: ch.logo,
        category: 'sports,football,world-cup',
        streamType: ch.streamType,
        streamUrl: ch.url,
        language: ch.language,
        country: ch.country,
        tags: [ch.group, 'FIFA', 'world-cup', 'live', ch.streamType].join(','),
        isFeatured: false,
        isActive: true,
      },
    })

    console.log(`ADDED ${ch.name.padEnd(50)} [${ch.streamType.padEnd(12)}] ${created.id}`)
    added++
  }

  console.log(`\n=== Done: ${added} added, ${skipped} skipped (already existed) ===\n`)

  const sportsCount = await db.channel.count({
    where: { category: { contains: 'sports' } },
  })
  console.log(`Total sports-category channels now: ${sportsCount}`)

  // Show fifalive.click channels specifically
  const fifaCount = await db.channel.count({
    where: { streamUrl: { contains: 'fifalive' } },
  })
  console.log(`Channels with fifalive-related URLs: ${fifaCount}`)

  // Show counts by streamType
  const direct = await db.channel.count({ where: { streamType: 'm3u8_direct' } })
  const proxy = await db.channel.count({ where: { streamType: 'm3u8_proxy' } })
  console.log(`m3u8_direct channels: ${direct}`)
  console.log(`m3u8_proxy channels: ${proxy}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error('Import failed:', e)
  process.exit(1)
})
