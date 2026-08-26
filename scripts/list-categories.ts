import { db } from '@/lib/db'
const cats = await db.category.findMany({ orderBy: { order: 'asc' } })
console.log(JSON.stringify(cats, null, 2))
await db.$disconnect()
