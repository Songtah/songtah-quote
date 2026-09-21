/**
 * /api/admin/medical-monitor/verify — 異常候選批次查證（第 3 層）
 *
 * GET   讀上次查證結果（頁面顯示「已查證」徽章用）
 * POST  對目前的異常候選逐筆即時查衛福部（限同縣市），回傳摘要並存檔
 *       body: { categories?: ('closure'|'hospital'|'invalidcode'|'codechange')[] }
 *
 * 只查證與記錄，不自動改客戶主檔——機構狀態影響全頁統計，一律由人一鍵套用。
 * 逐筆間隔 400ms（對衛福部 WAF 禮貌），127 筆約 1 分鐘。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { computeMonitor } from '@/lib/medical-monitor-compare'
import { verifyCandidates, getVerifyResults, type VerifyTarget } from '@/lib/notion/monitor-verify'
import { getCachedMonitorResult } from '@/lib/notion/medical-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = withApiAuth('admin', async () => {
  return NextResponse.json({ results: await getVerifyResults() })
})

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const want: string[] = Array.isArray(body.categories) && body.categories.length
      ? body.categories
      : ['closure', 'hospital', 'invalidcode', 'codechange']

    // 用上次比對結果；沒有才重算（重算很重，不該是常態）
    const result: any = (await getCachedMonitorResult()) ?? (await computeMonitor())
    const targets: VerifyTarget[] = []
    const push = (list: any[], kind?: string, codeField = 'institutionCode') => {
      for (const x of list ?? []) {
        targets.push({
          customerId: x.customerId, customerName: x.customerName,
          city: x.customerCity ?? '', institutionCode: x[codeField] ?? '',
          crmStatus: x.customerStatus ?? '', kind,
        })
      }
    }
    if (want.includes('closure'))    push(result.suspectedClosures)
    if (want.includes('hospital'))   push(result.hospitalUnverified, 'A')
    if (want.includes('invalidcode')) push(result.invalidCodes)
    if (want.includes('codechange')) push(result.codeChanged, undefined, 'newCode')

    // 同一客戶只查一次
    const seen = new Set<string>()
    const unique = targets.filter((t) => t.customerId && !seen.has(t.customerId) && seen.add(t.customerId))

    const { results, summary } = await verifyCandidates(unique)
    return NextResponse.json({ ok: true, summary, results })
  } catch (error: any) {
    console.error('monitor verify error:', error)
    return NextResponse.json({ error: error?.message ?? '查證失敗' }, { status: 500 })
  }
})
