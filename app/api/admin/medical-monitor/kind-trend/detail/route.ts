/**
 * GET /api/admin/medical-monitor/kind-trend/detail?month=YYYY-MM&kind=牙醫診所&dir=added|removed
 * 趨勢圖點長條 → 該月該類別的逐筆名單。
 *   added：新開業（非客戶）＋恢復開業（客戶的代碼重新出現在名冊）
 *   removed：從名冊消失者，附衛福部詳細頁直查的真實狀態（歇業／停業／仍開業＝科別或類別異動／待查證）
 * 另標出目前是否已在客戶主檔（含負責業務），方便直接接手。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getMonitorKindTrendRecords, type MonitorTrendKind } from '@/lib/notion/medical-monitor'
import { getCustomersWithCodes } from '@/lib/notion/customers'
import { loadBasCacheIndex, basVerdict } from '@/lib/bas-cache-index'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const KINDS: MonitorTrendKind[] = ['牙醫診所', '牙體技術所', '醫院']

export const GET = withApiAuth('admin', async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const month = sp.get('month') ?? ''
  const kind = sp.get('kind') as MonitorTrendKind
  const dir = sp.get('dir') === 'removed' ? 'removed' : 'added'
  if (!/^\d{4}-\d{2}$/.test(month) || !KINDS.includes(kind)) {
    return NextResponse.json({ error: '參數錯誤' }, { status: 400 })
  }
  try {
    const [records, customers] = await Promise.all([
      getMonitorKindTrendRecords(month, kind, dir),
      getCustomersWithCodes().catch(() => []),
    ])
    const custByCode = new Map(customers.filter((c) => c.institutionCode).map((c) => [c.institutionCode.trim(), c]))
    const bas = loadBasCacheIndex()
    const items = records.map((r) => {
      const code = r.institutionCode.trim()
      const b = bas.get(code)
      const c = custByCode.get(code)
      return {
        code,
        name: r.nhiName || b?.name || r.customerName || r.title,
        address: b?.address || r.address,
        specialty: r.specialty,
        changeType: r.type,                      // 新開業／恢復開業／停業／新增停業
        termDate: r.termDate,
        basStatus: b?.statusCheckedAt ? b.status : '',
        basVerdict: dir === 'removed' ? basVerdict(b) : undefined,
        basDetailUrl: b?.detailUrl ?? '',
        customer: c ? { id: c.id, name: c.name, salesperson: c.salesperson, status: c.status } : null,
      }
    }).sort((a, b) => (a.address || '').localeCompare(b.address || '') || a.name.localeCompare(b.name))
    return NextResponse.json({ month, kind, dir, items })
  } catch (error: any) {
    console.error('kind-trend detail error:', error)
    return NextResponse.json({ error: error?.message ?? '讀取失敗' }, { status: 500 })
  }
})
