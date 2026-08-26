/**
 * One-time fix script for iframe-type channels.
 *
 * Background:
 *  - Several channels were tagged `streamType: 'iframe'` but pointed at backends
 *    that either (a) send X-Frame-Options: SAMEORIGIN / Cloudflare anti-bot,
 *    (b) are MPEG-DASH .mpd manifests mislabeled as iframe, or (c) return 404.
 *  - Only the bhalocast.pro backend (playeraio.top embed wrapper) actually plays
 *    inside an iframe, because it registers a P2P service-worker on its own
 *    origin. For that one we use the raw-embed `iframe_direct` player mode.
 *
 * Idempotent: safe to re-run.
 *
 * Usage:  bun run scripts/fix-iframe-channels.ts
 */
import { db } from '@/lib/db'

async function main() {
  console.log('Applying iframe-channel fixes...\n')

  // 1. TNT Sports 1 — switch to iframe_direct so the bhalocast.pro
  //    service-worker can register inside the nested iframe.
  const tnt = await db.channel.updateMany({
    where: { streamUrl: { contains: 'playeraio.top/embed2.php?id=btsp1' } },
    data: { streamType: 'iframe_direct', isActive: true },
  })
  console.log(`TNT Sports 1 → iframe_direct: ${tnt.count} row(s) updated`)

  // 2. Star Sports 1 — cdn.dadocric.st returns HTTP 404.
  const starSports1 = await db.channel.updateMany({
    where: { streamUrl: { contains: 'cdn.dadocric.st/embed.php?id=starsp' } },
    data: { isActive: false },
  })
  console.log(`Star Sports 1 (404 dead) → inactive: ${starSports1.count} row(s)`)

  // 3. MPEG-DASH .mpd manifests that were mislabeled as 'iframe' and return 400.
  const mpdResult = await db.channel.updateMany({
    where: {
      streamType: 'iframe',
      streamUrl: { contains: '.mpd' },
    },
    data: { isActive: false },
  })
  console.log(`Mislabeled .mpd channels → inactive: ${mpdResult.count} row(s)`)

  // 4. playerado.top → bhalocast.com backends are Cloudflare-protected and
  //    send X-Frame-Options: SAMEORIGIN. Cannot be embedded at all.
  const playeradoResult = await db.channel.updateMany({
    where: {
      streamType: 'iframe',
      streamUrl: { contains: 'playerado.top/embed2.php' },
    },
    data: { isActive: false },
  })
  console.log(
    `playerado.top (Cloudflare-blocked) → inactive: ${playeradoResult.count} row(s)`,
  )

  console.log('\nDone.')
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
