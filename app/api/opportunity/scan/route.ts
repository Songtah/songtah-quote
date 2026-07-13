/**
 * POST /api/opportunity/scan — 掃描某區牙醫診所產生商機標籤(限 admin/中央管理;涉及 Google 費用)
 * body: { city, district, dryRun? }
 *   dryRun(預設 true):Google Places 反查+官網掃描,回預覽(命中標籤+證據+費用估算),不寫。
 *   dryRun=false:同上並把商機標籤「加」進客戶主檔(只加不蓋)。
 *
 * 費用:每家約 US$0.03(Google Places),故限管理層。大區數百家耗時,maxDuration 拉高。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { scanDistrict } from '@/lib/notion/opportunity'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = withApiAuth({ roles: ['中央管理'] }, async (req: NextRequest, _ctx, session) => {
  try {
    const b = await req.json()
    const city = (b.city ?? '').trim()
    const district = (b.district ?? '').trim()
    if (!city || !district) return NextResponse.json({ error: '缺少縣市/行政區' }, { status: 400 })
    const dryRun = b.dryRun !== false

    const result = await scanDistrict(city, district, { dryRun })

    if (!dryRun) {
      await logAuditEvent({
        module: 'clinic_monitor', action: 'update', entityType: 'opportunity-scan',
        entityId: `${city}|${district}`,
        summary: `商機掃描寫入:${city}${district} 共 ${result.total} 家,命中 ${result.tagged} 家(金訊號 ${result.goldCustomers}),寫入 ${result.written}`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { city, district, tagged: result.tagged, gold: result.goldCustomers, written: result.written, apiCalls: result.apiCalls },
      }).catch(() => {})
    }
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('opportunity scan error:', error)
    return NextResponse.json({ error: error?.message || '掃描失敗' }, { status: 500 })
  }
})
