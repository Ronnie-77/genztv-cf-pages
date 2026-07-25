export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getVapidPublicKeyAsync } from '@/lib/vapid'

// GET /api/push/vapid-key — Get VAPID public key for push subscription
export async function GET() {
  return NextResponse.json({ publicKey: await getVapidPublicKeyAsync() })
}
