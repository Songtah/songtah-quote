import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getEquipmentById, updateEquipment } from '@/lib/system-notion'

export const GET = withApiAuth('session', async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const equipment = await getEquipmentById(params.id)
  if (!equipment) return NextResponse.json({ error: '找不到設備' }, { status: 404 })
  return NextResponse.json(equipment)
})

export const PATCH = withApiAuth({ module: 'crm', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }) => {
  const body = await req.json()
  await updateEquipment(params.id, body)
  const updated = await getEquipmentById(params.id)
  return NextResponse.json(updated)
})
