/**
 * /api/bd/tenders/search — 歷史標案查詢（直接查政府電子採購網官網）
 *
 * 和每兩小時的自動抓取不同：這支是人主動查「以前有沒有這種標案」，
 * 關鍵字與年度由使用者指定，不套牙科命中判定（使用者自己下的關鍵字就是意圖）。
 * GET  ?q=牙科&year=115&kind=招標|決標  → 查詢結果，並標記哪些已在系統內
 * POST { hit }                          → 把查到的案子加入追蹤（寫進標案 DB）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { searchKeyword, hitToRecord } from '@/lib/tender-pcc'
import { listTenderRows } from '@/lib/notion/tenders-db'
import { ingestTenders } from '@/lib/notion/tenders'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: unknown, max = 200) => String(v ?? '').slice(0, max)

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest) => {
  const q = str(req.nextUrl.searchParams.get('q'), 40).trim()
  const kind = req.nextUrl.searchParams.get('kind') === '決標' ? '決標' as const : '招標' as const
  const thisRoc = new Date().getFullYear() - 1911
  const year = Math.min(Math.max(Number(req.nextUrl.searchParams.get('year')) || thisRoc, 88), thisRoc)
  if (!q) return NextResponse.json({ error: '請輸入關鍵字' }, { status: 400 })

  try {
    const [hits, rows] = await Promise.all([searchKeyword(q, kind, year), listTenderRows().catch(() => [])])
    const known = new Set(rows.map((r) => `${r.unitName}|${r.jobNumber}`))
    return NextResponse.json({
      keyword: q, kind, year,
      results: hits.map((h) => ({
        url: `https://web.pcc.gov.tw/prkms/urlSelector/common/${h.path}?pk=${h.pk}`,
        unitName: h.unitName, jobNumber: h.jobNumber, title: h.title,
        type: h.type, date: h.date, deadline: h.deadline,
        inDb: known.has(`${h.unitName}|${h.jobNumber}`),
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ error: `查詢失敗：${error?.message ?? error}` }, { status: 502 })
  }
})

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const url = str(body.url, 300)
    if (!url.startsWith('https://web.pcc.gov.tw/')) return NextResponse.json({ error: '公告連結不正確' }, { status: 400 })
    const record = hitToRecord({
      url,
      unitName: str(body.unitName, 100), jobNumber: str(body.jobNumber, 60),
      title: str(body.title, 200), type: str(body.type, 40),
      date: str(body.date, 10), deadline: str(body.deadline, 10),
    })
    if (!record.unitName || !record.jobNumber) return NextResponse.json({ error: '缺少機關或案號' }, { status: 400 })
    await ingestTenders([record])
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? '加入失敗' }, { status: 500 })
  }
})
