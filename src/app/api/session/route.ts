export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'

// In CF Pages deployment: only admin auth exists (no NextAuth/Google login)
// This route returns admin user info if authenticated, or null for regular visitors
export async function GET(req: NextRequest) {
  try {
    const isAdmin = await isAdminAuthenticated(req)
    if (isAdmin) {
      return NextResponse.json({
        user: {
          id: 'admin',
          name: 'Admin',
          email: 'admin@genztv.local',
          image: null,
          role: 'admin',
        },
      })
    }
    return NextResponse.json({ user: null })
  } catch (error) {
    console.error('[User Session] Error:', error)
    return NextResponse.json({ user: null })
  }
}
