/**
 * One-time fix: update Sky Sports Cricket (NTV) channel URL.
 *
 * Background:
 *  - The DB had an `ntv.cx/embed?t=...` URL whose token has expired. ntv.cx now
 *    returns HTTP 400 "Invalid or expired stream token", which means:
 *      1. The iframe-proxy loads a useless 400 error page (black screen).
 *      2. extract-m3u8 still works because it follows the ntv.cx → cdnlivetv.tv
 *         redirect chain, but adds ~300ms of latency.
 *
 * Fix:
 *  - Replace the expired ntv.cx URL with the underlying cdnlivetv.tv direct
 *    player URL (which ntv.cx embeds internally anyway). This URL:
 *      • Never expires (no token in the URL — the token is generated on each
 *        request to /api/extract-m3u8 by fetching cdnlivetv.tv server-side).
 *      • Lets extract-m3u8 skip the ntv.cx redirect hop, saving ~300ms.
 *      • Stops the iframe-proxy from loading a 400 error page (no more black
 *        screen during the initial loading window).
 *
 * Idempotent: safe to re-run.
 *
 * Usage:  bun run scripts/fix-sky-cricket-url.ts
 */
import { db } from '@/lib/db'

async function main() {
  console.log('Updating Sky Sports Cricket (NTV) channel URL...')

  // Match by current URL pattern (more reliable than name match for SQLite,
  // which doesn't support case-insensitive mode).
  const result = await db.channel.updateMany({
    where: {
      streamUrl: { contains: 'ntv.cx/embed' },
      OR: [
        { name: { contains: 'Sky Sports Cricket' } },
        { name: { contains: 'sky sports cricket' } },
      ],
    },
    data: {
      streamUrl:
        'https://cdnlivetv.tv/api/v1/channels/player/?name=Sky%20Sports%20Cricket&code=gb&user=ntvstream&plan=free',
      // Keep streamType='iframe' — isM3u8Extractable() matches cdnlivetv.tv,
      // so VideoPlayer will call extract-m3u8 and switch to HlsPlayer.
      streamType: 'iframe',
      isActive: true,
    },
  })

  console.log(`Updated ${result.count} row(s).`)

  // Verify
  const updated = await db.channel.findFirst({
    where: { name: { contains: 'Sky Sports Cricket' } },
    select: { name: true, streamType: true, streamUrl: true, isActive: true },
  })
  if (updated) {
    console.log(
      `Verified: [${updated.isActive ? 'ACTIVE' : 'INACTIVE'}] [${updated.streamType}] ${updated.name}`,
    )
    console.log(`  URL: ${updated.streamUrl}`)
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
