import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFeaturedFamilyIds, setFeaturedFamilyIds } from '@/lib/products-settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const familyIds = await getFeaturedFamilyIds()
  return NextResponse.json({ familyIds })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!session || (user?.role !== 'admin' && user?.accountType !== '行政')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { familyIds } = await req.json()
  if (!Array.isArray(familyIds)) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  await setFeaturedFamilyIds(familyIds)
  return NextResponse.json({ ok: true })
}
