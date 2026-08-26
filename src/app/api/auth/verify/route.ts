import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'

// GET /api/auth/verify — check if current session is valid
export async function GET(req: NextRequest) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (authenticated) {
      return NextResponse.json({ authenticated: true })
    }
    return NextResponse.json({ authenticated: false }, { status: 401 })
  } catch (error) {
    console.error('Verify error:', error)
    return NextResponse.json({ authenticated: false }, { status: 500 })
  }
}
