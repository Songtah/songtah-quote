/**
 * GET /api/admin/medical-monitor —— 醫事比對結果（管理頁）
 *
 * 比對邏輯已抽到 lib/medical-monitor-compare.ts，讓業務個人頁的「轄區新機構」
 * 與本頁用同一份計算，不會兩邊各寫一套而漂移。型別由此 re-export 維持既有 import 相容。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getCachedMonitorResult, setCachedMonitorResult } from '@/lib/system-notion'
import { computeMonitor } from '@/lib/medical-monitor-compare'
import { runExclusiveScan } from '@/lib/notion/shared'

export const maxDuration = 300   // 冷快取時要全掃客戶庫；另一個重算進行中時會等它

export type {
  SnapshotEntry, Snapshot, InstitutionCategory, NewOpening, NormalOperating, SuspectedClosure, CodeChanged, HospitalUnverified, CodeNotFound, SelfManagedCustomer, InconsistentData, MonitorStats, AcademicInstitution, InvalidCode, SameCityCandidate, UnregisteredInstitution, SuspectedReopen, MonitorDismissEntry, MonitorResult,
} from '@/lib/medical-monitor-compare'

export const GET = withApiAuth('admin', async (req: NextRequest) => {
  // 開頁（無 refresh）→ 直接回上次比對結果（伺服器端共用，跨裝置/不受清快取影響）。
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  if (!refresh) {
    const cached = await getCachedMonitorResult()
    if (cached) return NextResponse.json(cached)
  }

  try {
    // 同一時間只跑一個全掃；別人（另一個分頁、每晚排程）正在算就等它，算完直接回它存的結果
    const started = Date.now()
    const out = await runExclusiveScan(() => computeMonitor(), async () => {
      const c = await getCachedMonitorResult<{ computedAt?: string }>()
      return !!c && (!refresh || Date.parse(c.computedAt ?? '') >= started)
    })
    if (!out.ran) return NextResponse.json(await getCachedMonitorResult())
    await setCachedMonitorResult(out.value)   // 「執行比對」或首次計算 → 存起來供下次開頁顯示
    return NextResponse.json(out.value)
  } catch (e: any) {
    console.error('medical-monitor compute error:', e)
    return NextResponse.json({ error: e?.message ?? '比對失敗' }, { status: 500 })
  }
})
