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

  const result = await computeMonitor()
  await setCachedMonitorResult(result)   // 「執行比對」或首次計算 → 存起來供下次開頁顯示
  return NextResponse.json(result)
})
