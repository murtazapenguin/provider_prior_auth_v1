import { NextResponse } from 'next/server'
import { aiHealth } from '@/lib/ai'

export async function GET() {
  const result = await aiHealth()
  return NextResponse.json(result)
}
