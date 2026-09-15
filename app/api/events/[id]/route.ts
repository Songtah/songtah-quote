import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getEventById, updateEvent, deleteEvent, listEventRegistrations,
  updateRegistrationStatus, getRegistrationById, updateRegistrationPayment, updateRegistrationLinks, PAYMENT_STATUSES,
} from '@/lib/notion/events'
import { getSystemCustomerById } from '@/lib/notion/customers'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'
import { processRegistrations, invalidateEventFootprints } from '@/lib/registration-footprint'
import { signCheckinToken, isCheckinOpen } from '@/lib/checkin-token'
import { canEdit } from '@/lib/permissions'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const { id } = params
  const url = new URL(req.url)

  if (url.searchParams.get('registrations') === '1') {
    const regs = await listEventRegistrations(id)
    // 帶上配對客戶的名稱與區域（報名紀錄只存 relation id），5 筆一批避免打爆 Notion
    const ids = Array.from(new Set(regs.map((r) => r.customerId).filter(Boolean)))
    const names = new Map<string, { name: string; area: string }>()
    for (let i = 0; i < ids.length; i += 5) {
      const batch = await Promise.all(ids.slice(i, i + 5).map((cid) => getSystemCustomerById(cid).catch(() => null)))
      batch.forEach((c, j) => { if (c) names.set(ids[i + j], { name: c.name, area: `${c.city}${c.district}` }) })
    }
    return NextResponse.json(regs.map((r) => ({
      ...r,
      customerName: names.get(r.customerId)?.name ?? '',
      customerArea: names.get(r.customerId)?.area ?? '',
    })))
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

  // 報名紀錄的更新：先確認 id 真的是活動報名 DB 的頁面（避免拿任意 Notion 頁面 id 來改）
  if (body._type === 'registration' || body._type === 'registration-payment' || body._type === 'registration-customer') {
    const reg = await getRegistrationById(id)
    if (!reg) return NextResponse.json({ error: '找不到報名紀錄' }, { status: 404 })

    // 人工調整客戶配對：指定某客戶或取消配對。配對說明以「人工」開頭，自動配對排程不會再覆蓋
    if (body._type === 'registration-customer') {
      const who = session.user?.name || '使用者'
      let customer: Awaited<ReturnType<typeof getSystemCustomerById>> = null
      if (body.customerId) {
        if (typeof body.customerId !== 'string') return NextResponse.json({ error: '客戶資料錯誤' }, { status: 400 })
        customer = await getSystemCustomerById(body.customerId)
        if (!customer) return NextResponse.json({ error: '找不到該客戶' }, { status: 404 })
      }
      const matchNote = customer ? `人工指定：${customer.name}（${who}）` : `人工取消配對（${who}）`
      await updateRegistrationLinks(id, { customerId: customer?.id ?? null, matchNote })
      invalidateEventFootprints()
      logAuditEvent({
        module: 'events', action: 'update', entityType: 'registration', entityId: id, entityTitle: reg.institution,
        summary: customer ? `人工配對客戶：${reg.institution} → ${customer.name}` : `人工取消配對：${reg.institution}`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        before: { customerId: reg.customerId, matchNote: reg.matchNote }, after: { customerId: customer?.id ?? '', matchNote },
      }).catch(() => {})
      return NextResponse.json({
        ok: true, customerId: customer?.id ?? '', customerName: customer?.name ?? '',
        customerArea: customer ? `${customer.city}${customer.district}` : '', matchNote,
      })
    }
    if (body._type === 'registration-payment') {
      if (!(PAYMENT_STATUSES as readonly string[]).includes(body.paymentStatus)) {
        return NextResponse.json({ error: '無效的付款狀態' }, { status: 400 })
      }
      await updateRegistrationPayment(id, body.paymentStatus)
      return NextResponse.json({ ok: true })
    }
  }

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

  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })

  // 線上報名頁設定：逐欄驗證，只寫有帶的欄位
  const patch: Parameters<typeof updateEvent>[1] = {}
  for (const k of ['name', 'date', 'endDate', 'location', 'type', 'deadline', 'status', 'description'] as const) {
    if (typeof body[k] === 'string') patch[k] = body[k]
  }
  if (Array.isArray(body.campaignIds)) patch.campaignIds = body.campaignIds.filter((x: unknown) => typeof x === 'string')
  if (typeof body.onlineRegistration === 'boolean') patch.onlineRegistration = body.onlineRegistration
  if (typeof body.paid === 'boolean') patch.paid = body.paid
  if (body.fee !== undefined) {
    const fee = Math.round(Number(body.fee))
    if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) return NextResponse.json({ error: '報名費金額不正確' }, { status: 400 })
    patch.fee = fee
  }
  if (body.capacity !== undefined) {
    const cap = Math.floor(Number(body.capacity))
    if (!Number.isFinite(cap) || cap < 0 || cap > 100_000) return NextResponse.json({ error: '名額不正確' }, { status: 400 })
    patch.capacity = cap
  }
  if (typeof body.paymentNote === 'string') patch.paymentNote = body.paymentNote
  if (typeof body.bannerUrl === 'string') {
    // 只允許清空，或本系統上傳到 Vercel Blob 的網址（避免公開頁載入任意外部圖片）
    if (body.bannerUrl && !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(body.bannerUrl)) {
      return NextResponse.json({ error: '廣告圖請使用上傳功能' }, { status: 400 })
    }
    patch.bannerUrl = body.bannerUrl
  }
  if (patch.paid && (patch.fee ?? event.fee) <= 0) {
    return NextResponse.json({ error: '收費活動請填寫報名費' }, { status: 400 })
  }

  await updateEvent(id, patch)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
  if (!canEdit(session as any, 'events')) {
    return NextResponse.json({ error: '無刪除活動權限' }, { status: 403 })
  }
  if (!(await getEventById(params.id))) return NextResponse.json({ error: '找不到活動' }, { status: 404 })

  await deleteEvent(params.id)
  return NextResponse.json({ ok: true })
}
