import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getEventById, updateEvent, deleteEvent, listEventRegistrations,
  updateRegistrationStatus,
} from '@/lib/system-notion'
import { processRegistrations } from '@/lib/registration-footprint'
import { signCheckinToken, isCheckinOpen } from '@/lib/checkin-token'
import { canEdit } from '@/lib/permissions'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = params
  const url = new URL(req.url)

  if (url.searchParams.get('registrations') === '1') {
    const regs = await listEventRegistrations(id)
    return NextResponse.json(regs)
  }

  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })

  // 展會簽到連結（含簽章）只給能編輯活動的人
  if (url.searchParams.get('checkin') === '1') {
    if (!canEdit(session as any, 'events')) return NextResponse.json({ error: '無權限' }, { status: 403 })
    const t = signCheckinToken(id)
    if (!t) return NextResponse.json({ error: '伺服器未設定簽章密鑰' }, { status: 500 })
    return NextResponse.json({ url: `${req.nextUrl.origin}/checkin/${id}?t=${t}`, open: isCheckinOpen(event) })
  }
  return NextResponse.json(event)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'events')) {
    return NextResponse.json({ error: '無編輯活動權限' }, { status: 403 })
  }

  const { id } = params
  const body = await req.json()

  // If updating a registration status
  if (body._type === 'registration') {
    await updateRegistrationStatus(id, body.status)
    // 2026-09-15 移除「確認報名 → 自動建一筆待追蹤客情」：那會寫入沒有發生過的拜訪，
    // 讓該客戶的「最近拜訪日」被刷新、壓掉太久沒拜訪訊號，也會觸發追蹤自動結案的「已有更新拜訪」條件。
    // 活動後的跟進改由拜訪建議的「活動足跡」訊號驅動（lib/registration-footprint.ts），不寫假拜訪。
    return NextResponse.json({ ok: true })
  }

  // 重新配對這場活動的報名（通常由每小時排程處理，這裡給活動負責人立即更新用）
  if (body._type === 'process-registrations') {
    const regs = await listEventRegistrations(id)
    const result = await processRegistrations({ onlyIds: regs.map((r) => r.id), retryUnmatched: true })
    return NextResponse.json({ ok: true, ...result })
  }

  await updateEvent(id, body)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'events')) {
    return NextResponse.json({ error: '無刪除活動權限' }, { status: 403 })
  }

  await deleteEvent(params.id)
  return NextResponse.json({ ok: true })
}
