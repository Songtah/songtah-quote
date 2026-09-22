/**
 * POST /api/admin/medical-monitor/verify/one — 單筆「查證並更新」
 *
 * body: { customerId, customerName, city, crmCode?, crmStatus?, kind?, includeName? }
 *
 * 流程：即時查衛福部（名稱需完全相同、限同縣市、同縣市唯一）→ 逐欄比對 →
 * 直接寫回所有有異動的欄位（機構代碼、機構狀態、地址、電話、健保特約、人員數、三個連結）。
 * 名稱預設不改（客情比對依據），要改須帶 includeName。
 *
 * 給「更換代碼」等分頁的逐筆處理用：不必先跑整批查證，也不必自己開客戶頁改。
 * 驗證不通過（查無／只是名稱包含／同縣市多家同名／跨縣市）一律不寫，回傳原因。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { verifyCandidates } from '@/lib/notion/monitor-verify'
import { getSystemCustomerById, updateCustomerBasFields, type BasSyncPatch } from '@/lib/notion/customers'
import { invalidateMonitorResultCache } from '@/lib/notion/medical-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const VALID = new Set(['開業', '停業', '已歇業', '撤銷', '狀況不明'])

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const customerId = String(body.customerId ?? '')
    const customerName = String(body.customerName ?? '')
    if (!customerId || !customerName) {
      return NextResponse.json({ error: '缺少 customerId 或 customerName' }, { status: 400 })
    }

    const detail = await getSystemCustomerById(customerId).catch(() => null)
    const { results } = await verifyCandidates([{
      customerId,
      customerName,
      city: String(body.city ?? detail?.city ?? ''),
      institutionCode: String(body.code ?? detail?.institutionCode ?? ''),
      crmCode: String(body.crmCode ?? detail?.institutionCode ?? ''),
      crmStatus: String(body.crmStatus ?? detail?.status ?? ''),
      kind: body.kind ? String(body.kind) : undefined,
      crm: detail ? {
        address: detail.address, phone: detail.phone,
        dentistCount: detail.dentistCount, technicianCount: detail.technicianCount,
        technicianTraineeCount: detail.technicianTraineeCount,
      } : undefined,
    }])

    const r: any = results[0]
    if (!r) return NextResponse.json({ error: '查證失敗' }, { status: 500 })
    if (r.error)      return NextResponse.json({ ok: false, reason: `查詢失敗：${r.error}`, result: r })
    if (r.partialOnly) return NextResponse.json({ ok: false, reason: '衛福部沒有名稱完全相同的機構（只有相似名稱，屬不同家）', result: r })
    if (r.ambiguous)  return NextResponse.json({ ok: false, reason: '同縣市有多家名稱完全相同，無法判斷是哪一家', result: r })
    if (r.outOfCity)  return NextResponse.json({ ok: false, reason: '同縣市查無此機構（跨縣市同名不採用）', result: r })
    if (!r.found)     return NextResponse.json({ ok: false, reason: '衛福部查無此機構', result: r })

    const patch: BasSyncPatch = { ...(r.patch ?? {}) }
    if (patch.status && !VALID.has(patch.status)) delete patch.status
    if (patch.institutionCode && !/^[A-Za-z0-9]{4,20}$/.test(patch.institutionCode)) delete patch.institutionCode
    if (body.includeName) {
      const nameDiff = (r.diffs ?? []).find((d: any) => d.field === 'name')
      if (nameDiff?.to) patch.name = nameDiff.to
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, updated: [], reason: '與衛福部一致，沒有需要更新的欄位', result: r })
    }

    const changed = await updateCustomerBasFields(customerId, patch)
    await invalidateMonitorResultCache()
    return NextResponse.json({ ok: true, updated: changed, diffs: r.diffs, result: r })
  } catch (error: any) {
    console.error('verify one error:', error)
    return NextResponse.json({ error: error?.message ?? '處理失敗' }, { status: 500 })
  }
})
