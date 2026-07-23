export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/next-auth'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ user: null })
    }
    return NextResponse.json({
      user: {
        id: session.user.id || '',
        name: session.user.name || null,
        email: session.user.email || '',
        image: session.user.image || null,
      },
    })
  } catch (error) {
    console.error('[User Session] Error:', error)
    return NextResponse.json({ user: null })
  }
}
