import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getAllFamilies, getFamilyByCode } from '@/lib/products-catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const code = req.nextUrl.searchParams.get('code') ?? ''

  if (code) {
    const family = getFamilyByCode(code)
    return NextResponse.json(family ?? null)
  }

  return NextResponse.json(getAllFamilies())
}
