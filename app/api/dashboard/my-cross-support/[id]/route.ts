/**
 * PATCH /api/dashboard/my-cross-support/[id] — 指定／更正報備的客戶
 *
 * Slack 回報的客戶名稱比對不到時，建檔會留空 relation 並標「待確認」。
 * 這支讓人工把正確客戶補上（也可修正綁錯的），補上後轉為「已比對」。
 *
 * 權限：報備業務本人或管理帳號。不開放其他業務改別人的報備——
 * 報備內容關係到 14 日內成交的設備業績歸屬，不是誰都能動。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCrossSupportLogs, updateCrossSupportCustomer } from '@/lib/notion/cross-support'
import { searchSystemCustomers } from '@/lib/notion/customers'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase('zh-TW') === b.trim().toLocaleLowerCase('zh-TW')
}

export const PATCH = withApiAuth({ module: 'bd', action: 'edit' }, async (
  req: NextRequest, ctx: { params: { id: string } }, session,
) => {
  try {
    const user = session.user as any
    const me = session.user?.name?.trim() ?? ''
    const isManager = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'

    const body = await req.json()
    const customerId = String(body.customerId ?? '').trim()
    if (!/^[0-9a-f]{32}$/i.test(customerId.replace(/-/g, ''))) {
      return NextResponse.json({ error: '請選擇有效的客戶' }, { status: 400 })
    }

    // 讀回這筆確認擁有權。listCrossSupportLogs 不帶 range 會回全部，
    // 目前資料量小（個位數）可接受；量大時再加單筆讀取。
    const log = (await listCrossSupportLogs()).find((item) => item.id === ctx.params.id)
    if (!log) return NextResponse.json({ error: '找不到這筆報備' }, { status: 404 })
    if (!isManager && !sameName(log.reportingSalesperson, me)) {
      return NextResponse.json({ error: '只有報備業務本人可以更正客戶' }, { status: 403 })
    }

    // 用 id 反查客戶名稱（更新標題要用），順便確認這個 id 真的存在於客戶主檔
    const candidates = await searchSystemCustomers(String(body.customerName ?? '').trim() || ' ')
      .catch(() => [])
    const picked = candidates.find((c) => c.id.replace(/-/g, '') === customerId.replace(/-/g, ''))
    if (!picked) {
      return NextResponse.json({ error: '找不到該客戶，請重新搜尋後選擇' }, { status: 404 })
    }

    await updateCrossSupportCustomer(ctx.params.id, { id: picked.id, name: picked.name })

    await logAuditEvent({
      module: 'bd',
      action: 'update',
      entityType: 'cross-support',
      entityId: ctx.params.id,
      entityTitle: `${log.reportingSalesperson} 支援 ${picked.name}`,
      summary: `跨區支援報備指定客戶：${log.customerName || '（未比對到）'} → ${picked.name}`,
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before: { customerName: log.customerName, status: log.status },
      after: { customerName: picked.name, status: '已比對' },
    }).catch(() => {})

    return NextResponse.json({ id: ctx.params.id, customerName: picked.name, status: '已比對' })
  } catch (error: any) {
    console.error('my-cross-support PATCH error:', error)
    return NextResponse.json({ error: error?.message ?? '更新失敗' }, { status: 500 })
  }
})
