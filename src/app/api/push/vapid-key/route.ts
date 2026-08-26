import { NextResponse } from 'next/server'
import { getVapidPublicKey } from '@/lib/vapid'

// GET /api/push/vapid-key — Get VAPID public key for push subscription
export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() })
}
