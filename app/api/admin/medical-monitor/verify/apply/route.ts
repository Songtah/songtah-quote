/**
 * POST /api/admin/medical-monitor/verify/apply — 把批次查證結果一鍵寫回客戶資料庫
 *
 * 只套用「有實證」的變更：衛福部即時查詢**有查到**該機構、且換算後的狀態與客戶主檔不同。
 * 查無、查詢失敗、同縣市查不到（outOfCity）一律跳過——沒有證據就不改主檔。
 *
 * body: { customerIds?: string[] }  不給＝套用全部符合條件者
 *       { dryRun?: boolean }        先看會改哪些
 *
 * 這是本頁唯一的批次寫入路徑：機構狀態會連動全頁統計與業務看到的客戶清單，
 * 所以逐筆都要有衛福部實證，且畫面上一律先顯示筆數再由人按下確認。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { updateCustomerStatus } from '@/lib/system-notion'
import { getVerifyResults } from '@/lib/notion/monitor-verify'
import { invalidateMonitorResultCache } from '@/lib/notion/medical-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const VALID = new Set(['開業', '停業', '已歇業', '撤銷', '狀況不明'])

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const only: string[] | null = Array.isArray(body.customerIds) && body.customerIds.length
      ? body.customerIds.map(String) : null
    const dryRun = Boolean(body.dryRun)

    const results = await getVerifyResults()
    const targets = results.filter((r) =>
      r.found && !r.error && !r.outOfCity &&
      r.suggestedStatus && VALID.has(r.suggestedStatus) &&
      r.suggestedStatus !== r.crmStatus &&
      (!only || only.includes(r.customerId))
    )

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true, willUpdate: targets.length,
        items: targets.map((t) => ({
          customerId: t.customerId, customerName: t.customerName,
          from: t.crmStatus || '（未填）', to: t.suggestedStatus,
          basStatus: t.basStatus, checkedAt: t.checkedAt,
        })),
      })
    }

    let updated = 0
    const failures: { customerName: string; message: string }[] = []
    for (const t of targets) {
      try {
        await updateCustomerStatus(t.customerId, t.suggestedStatus)
        updated++
      } catch (e: any) {
        failures.push({ customerName: t.customerName, message: e?.message ?? '寫入失敗' })
      }
    }
    if (updated > 0) await invalidateMonitorResultCache()

    return NextResponse.json({
      ok: true, updated, skipped: results.length - targets.length, failures,
    })
  } catch (error: any) {
    console.error('verify apply error:', error)
    return NextResponse.json({ error: error?.message ?? '套用失敗' }, { status: 500 })
  }
})
