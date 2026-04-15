import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getEquipmentById, updateEquipment } from '@/lib/system-notion'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const equipment = await getEquipmentById(params.id)
  if (!equipment) return NextResponse.json({ error: '找不到設備' }, { status: 404 })

  return NextResponse.json(equipment)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const body = await req.json()
  await updateEquipment(params.id, body)
  const updated = await getEquipmentById(params.id)
  return NextResponse.json(updated)
}
