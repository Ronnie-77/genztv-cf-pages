import { db } from '../src/lib/db'

async function main() {
  const channels = await db.channel.findMany({
    select: { id: true, name: true, streamType: true, streamUrl: true },
    take: 40,
    orderBy: { name: 'asc' }
  })
  console.log('Total channels:', channels.length)
  for (const c of channels) {
    const urlShort = (c.streamUrl || '').substring(0, 70)
    console.log(`${(c.streamType||'').padEnd(15)} | ${(c.name||'').substring(0, 35).padEnd(35)} | ${urlShort}`)
  }
}
main().catch(console.error).finally(() => process.exit(0))
