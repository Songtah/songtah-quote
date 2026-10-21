/**
 * /api/admin/visit-reactions —— 用 Claude 判讀客情的「客戶反應」與對口（中央管理專用）
 *
 * POST { ids: string[] }                     判讀指定客情（一次最多 25 筆），只回結果、不寫入（驗證集用）
 * POST { action: 'rerun-create' }            全庫重跑：建立批次（Message Batches，半價）
 * POST { action: 'rerun-status' }            批次進度
 * POST { action: 'rerun-report' }            差異報表（不寫入）
 * POST { action: 'rerun-apply', offset, limit }  核可後分段寫入，改前的值存進還原紀錄
 * POST { action: 'rerun-undo', limit }       整批還原（分段）
 * POST { action: 'repair-candidates' }       舊客情回補：列出提到維修字眼、已關聯客戶的客情 id
 * POST { action: 'repair-apply', ids, dryRun }  舊客情回補：判讀並開工單（dryRun 只回會怎麼做）
 * GET  ?csv=1                                差異明細 CSV 下載
 * 金鑰只在伺服器端，不經本機。流程見 lib/visit-reaction-rerun.ts。
 * 會產生 Anthropic API 費用（Haiku，每筆約台幣 0.01 元），故限中央管理。規則見 lib/visit-reaction-ai.ts。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { classifyVisitReaction } from '@/lib/visit-reaction-ai'
import { getAuditActor, logAuditEvent } from '@/lib/audit'
import { createRerunBatch, rerunStatus, rerunReport, rerunCsv, applyRerun, undoRerun } from '@/lib/visit-reaction-rerun'
import { createRepairTicketFromVisit } from '@/lib/visit-repair-tickets'
import { scanVisitPages } from '@/lib/notion/visits'
import { getRelationIds } from '@/lib/notion/shared'
import { getSystemCustomerById } from '@/lib/notion/customers'

// 舊客情回補的粗篩字眼（只用來挑候選，真正判斷由 Claude 判讀）
const REPAIR_HINT = /維修|修理|故障|壞掉|壞了|報修|異常|保養|校正|送修|叫修|維護|卡住|不能用|無法使用|跳錯|錯誤碼|不會升溫|無法開機/
import { notion, notionCallWithRetry, getText, getTitle, getSelect, getDate } from '@/lib/notion/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = withApiAuth('central-management', async (req: NextRequest) => {
  if (req.nextUrl.searchParams.get('csv') !== '1') return NextResponse.json({ error: '缺少 csv=1' }, { status: 400 })
  try {
    const csv = await rerunCsv()
    return new NextResponse(csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('客戶反應重跑差異明細.csv')}`,
    } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '產生失敗' }, { status: 409 })
  }
})

export const POST = withApiAuth('central-management', async (req: NextRequest, _ctx, session) => {
  let body: { ids?: string[]; action?: string; offset?: number; limit?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: '格式錯誤' }, { status: 400 }) }
  if (body.action) {
    try {
      const limit = Math.min(Math.max(Number(body.limit) || 150, 1), 300)
      switch (body.action) {
        case 'rerun-create': {
          const state = await createRerunBatch()
          await logAuditEvent({ module: 'visits', action: 'create', entityType: 'visit-reaction-rerun', entityId: state.batchId,
            summary: `客戶反應全庫重跑：建立批次 ${state.count} 筆`, actor: getAuditActor(session), after: state }).catch(() => {})
          return NextResponse.json(state)
        }
        case 'rerun-status': return NextResponse.json(await rerunStatus())
        case 'rerun-report': return NextResponse.json(await rerunReport())
        case 'rerun-apply': {
          const out = await applyRerun({ offset: Math.max(Number(body.offset) || 0, 0), limit })
          await logAuditEvent({ module: 'visits', action: 'update', entityType: 'visit-reaction-rerun', entityId: `offset-${out.offset}`,
            summary: `客戶反應全庫重跑寫入：第 ${out.offset + 1}–${out.nextOffset} 筆，改反應 ${out.reactions}、補聯絡人 ${out.contacts}、失敗 ${out.failed}`,
            actor: getAuditActor(session), after: out }).catch(() => {})
          return NextResponse.json(out)
        }
        case 'rerun-undo': return NextResponse.json(await undoRerun({ limit }))
        case 'repair-candidates': {
          const ids: string[] = []; let unlinked = 0
          for await (const p of scanVisitPages('repair-candidates')) {
            if (!REPAIR_HINT.test(getText(p, '拜訪內容'))) continue
            if (getRelationIds(p, '🏥 牙科單位資料')[0]) ids.push(p.id); else unlinked++
          }
          return NextResponse.json({ ids, unlinked })
        }
        case 'repair-apply': {
          const ids = (Array.isArray((body as any).ids) ? (body as any).ids : []).slice(0, 20) as string[]
          const dryRun = (body as any).dryRun !== false
          const out: any[] = []
          for (const id of ids) {
            try {
              const page: any = await notionCallWithRetry('repair-apply:get', () => notion.pages.retrieve({ page_id: id }))
              const text = getText(page, '拜訪內容')
              const judged = await classifyVisitReaction(text)
              if (!judged?.repair) { out.push({ id, action: 'none' }); continue }
              const cid = getRelationIds(page, '🏥 牙科單位資料')[0]
              const c = cid ? await getSystemCustomerById(cid) : null
              const res = await createRepairTicketFromVisit({
                visitId: id, visitDate: getDate(page, '日期'), salesperson: getSelect(page, '業務人員') || getText(page, '業務人員'),
                customerId: c?.id, customerName: c?.name || getTitle(page, '單位名稱'), repair: judged.repair,
              }, { dryRun })
              out.push({ id, date: getDate(page, '日期'), name: c?.name || getTitle(page, '單位名稱'), repair: judged.repair, ...res })
            } catch (e: any) { out.push({ id, action: 'error', reason: e?.message }) }
          }
          if (!dryRun) await logAuditEvent({ module: 'tickets', action: 'create', entityType: 'repair-ticket-backfill', entityId: ids[0] ?? '',
            summary: `舊客情維修回補：處理 ${ids.length} 筆，開單 ${out.filter((o) => o.action === 'created').length}、補進既有 ${out.filter((o) => o.action === 'appended').length}`,
            actor: getAuditActor(session) }).catch(() => {})
          return NextResponse.json({ dryRun, results: out })
        }
        default: return NextResponse.json({ error: '不明的動作' }, { status: 400 })
      }
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? '執行失敗' }, { status: 409 })
    }
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{32,36}$/i.test(x)).slice(0, 25) : []
  if (!ids.length) return NextResponse.json({ error: '缺少 ids' }, { status: 400 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: '尚未設定 ANTHROPIC_API_KEY' }, { status: 503 })

  const results: any[] = []
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      try {
        const page: any = await notionCallWithRetry('visit-reactions:get', () => notion.pages.retrieve({ page_id: id }))
        const text = getText(page, '拜訪內容')
        const r = await classifyVisitReaction(text)
        return {
          id, date: getDate(page, '日期'), name: getTitle(page, '單位名稱'),
          old: getSelect(page, '客戶反應'), oldContact: getText(page, '聯絡人'),
          ...(r ? { reaction: r.reaction, evidence: r.evidence, confidence: r.confidence, contact: r.contact, note: r.note } : { error: '判讀失敗' }),
        }
      } catch (e: any) {
        return { id, error: e?.message ?? '讀取失敗' }
      }
    }))
    results.push(...batch)
  }
  return NextResponse.json({ results })
})
