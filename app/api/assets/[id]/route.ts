/**
 * DELETE /api/assets/[id]  → archive (soft-delete) an asset in Notion
 */

import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { deleteAsset } from '@/lib/assets-notion'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = params
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  await deleteAsset(id)
  return NextResponse.json({ ok: true })
}
