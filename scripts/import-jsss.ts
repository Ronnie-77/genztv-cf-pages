import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const db = new PrismaClient()

async function main() {
  const raw = readFileSync('/home/z/my-project/public/jsssbd-channels.json', 'utf8')
  const data = JSON.parse(raw) as { channels: Array<{
    name: string; logo: string; group: string; streamType: string;
    url: string; language: string; country: string; note: string
  }> }

  console.log(`Importing ${data.channels.length} channels from JSSS TV...`)

  // De-dup by URL — skip channels whose streamUrl already exists
  let created = 0, skipped = 0
  for (const c of data.channels) {
    const existing = await db.channel.findFirst({ where: { streamUrl: c.url }, select: { id: true, name: true } })
    if (existing) {
      console.log(`  SKIP (exists): ${c.name}`)
      skipped++
      continue
    }
    await db.channel.create({
      data: {
        name: c.name,
        logo: c.logo,
        category: (c.group || 'entertainment').toLowerCase(),
        streamType: c.streamType,
        streamUrl: c.url,
        language: c.language || '',
        country: c.country || '',
        tags: c.group || '',
        isActive: true,
        // Token-refresh metadata (tokenless streams, but keep source for re-extraction)
        sourcePageUrl: 'https://tv.jsssbd.com/index.php',
        autoRefresh: false,
      }
    })
    created++
  }

  console.log(`\n✅ Done. Created: ${created}, Skipped (existing): ${skipped}`)
  const total = await db.channel.count()
  console.log(`Total channels in DB now: ${total}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
