import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listAllFamilyAssignments } from '@/lib/products-notion'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const skuCodes = await listAllFamilyAssignments().catch(() => [])
  return NextResponse.json({ skuCodes })
}
