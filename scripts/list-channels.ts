import { db } from '@/lib/db'

async function main() {
  const channels = await db.channel.findMany({
    select: { id: true, name: true, category: true, streamType: true, streamUrl: true },
    orderBy: { category: 'asc' },
  })
  console.log(`Total channels: ${channels.length}`)
  for (const c of channels) {
    console.log(`[${c.category}] ${c.name} (${c.streamType}): ${c.streamUrl.slice(0, 80)}`)
  }
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
