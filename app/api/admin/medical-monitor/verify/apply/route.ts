/**
 * POST /api/admin/medical-monitor/verify/apply — 把批次查證結果一鍵寫回客戶資料庫
 *
 * 只套用「有實證」的變更：衛福部即時查詢**有查到**該機構，且該欄位與主檔不同。
 * 涵蓋 機構狀態／機構代碼／地址／電話／健保特約／牙醫師數／牙體技術師數／牙體技術生數／
 * 機構資料連結／醫事人員連結／診療科別連結（使用者 2026-09-22 定調：有異動的都要更）。
 * 只改狀態不改代碼的話，舊碼下個月依然查不到、同一家會再變成候選，永遠對不完。
 *
 * **客戶名稱**例外：它是客情紀錄比對的依據，改名會影響既有關聯，
 * 只有呼叫端明確帶 includeName 才寫入。
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
import { updateCustomerBasFields, type BasSyncPatch } from '@/lib/notion/customers'
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
    const includeName = Boolean(body.includeName)

    const results = await getVerifyResults()
    const patchOf = (r: any): BasSyncPatch => {
      const p: BasSyncPatch = { ...(r.patch ?? {}) }
      if (p.status && !VALID.has(p.status)) delete p.status
      if (p.institutionCode && !/^[A-Za-z0-9]{4,20}$/.test(p.institutionCode)) delete p.institutionCode
      if (includeName) {
        const nameDiff = (r.diffs ?? []).find((d: any) => d.field === 'name')
        if (nameDiff?.to) p.name = nameDiff.to
      }
      return p
    }

    const targets = results.filter((r) =>
      r.found && !r.error && !r.outOfCity &&
      Object.keys(patchOf(r)).length > 0 &&
      (!only || only.includes(r.customerId))
    )

    if (dryRun) {
      const fieldCount: Record<string, number> = {}
      for (const t of targets) {
        for (const k of Object.keys(patchOf(t))) fieldCount[k] = (fieldCount[k] ?? 0) + 1
      }
      return NextResponse.json({
        ok: true, dryRun: true, willUpdate: targets.length,
        fieldCount,
        nameDiffs: results.filter((r) => (r.diffs ?? []).some((d: any) => d.field === 'name')).length,
        items: targets.map((t) => ({
          customerId: t.customerId, customerName: t.customerName,
          basStatus: t.basStatus, checkedAt: t.checkedAt,
          diffs: (t.diffs ?? []).filter((d: any) => includeName || d.field !== 'name'),
        })),
      })
    }

    let updated = 0, fieldsUpdated = 0
    const failures: { customerName: string; message: string }[] = []
    for (const t of targets) {
      try {
        const changed = await updateCustomerBasFields(t.customerId, patchOf(t))
        if (changed.length) { updated++; fieldsUpdated += changed.length }
      } catch (e: any) {
        failures.push({ customerName: t.customerName, message: e?.message ?? '寫入失敗' })
      }
    }
    if (updated > 0) await invalidateMonitorResultCache()

    return NextResponse.json({
      ok: true, updated, fieldsUpdated,
      skipped: results.length - targets.length, failures,
    })
  } catch (error: any) {
    console.error('verify apply error:', error)
    return NextResponse.json({ error: error?.message ?? '套用失敗' }, { status: 500 })
  }
})
