/**
 * POST /api/bd/campaigns/[id]/members — 貼上清單 → 比對客戶主檔 → 匯入成員
 *
 * body: { lines: string[], dryRun?: boolean }
 *   lines:每行一個客戶(名稱或機構代碼,允許前後空白)
 *   dryRun=true 只回比對結果不寫入(UI 先預覽再確認)
 *
 * 比對規則(route 層組合 customers 領域):
 *   1. 純數字/英數 5 碼以上 → 當機構代碼精準比對
 *   2. 其他 → 名稱正規化後精準比對(去空白/全形括號差異)
 *   已在名單內的客戶自動跳過(去重)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { addMembers, listMembers } from '@/lib/notion/campaigns'
import { getAllSystemCustomers } from '@/lib/notion/customers'
import { getCustomersWithCodes } from '@/lib/notion/customers'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const norm = (s: string) => s.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase()
const looksLikeCode = (s: string) => /^[A-Za-z0-9]{5,}$/.test(s.trim())

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  try {
    const body = await req.json()

    // ── 路徑 B:智慧產生後直接以 customerId 匯入(跳過文字比對,仍去重)──
    if (Array.isArray(body.members)) {
      const direct: { customerId: string; name: string; salesperson?: string }[] = body.members
        .filter((m: any) => m?.customerId && m?.name)
      if (direct.length === 0) return NextResponse.json({ error: '成員清單是空的' }, { status: 400 })
      if (direct.length > 500) return NextResponse.json({ error: '單次最多 500 筆' }, { status: 400 })
      const existingMembers = await listMembers(params.id)
      const alreadyIn = new Set(existingMembers.map((m) => m.customerId.replace(/-/g, '')))
      const toAdd = direct.filter((m) => !alreadyIn.has(m.customerId.replace(/-/g, '')))
      const created = await addMembers(params.id, toAdd)
      await logAuditEvent({
        module: 'bd', action: 'create', entityType: 'campaign-members',
        entityId: params.id, summary: `名單智慧匯入成員 ${created} 筆(重複跳過 ${direct.length - toAdd.length})`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { created, duplicated: direct.length - toAdd.length },
      }).catch(() => {})
      return NextResponse.json({ dryRun: false, created, duplicated: direct.length - toAdd.length, ambiguous: [], unmatched: [] })
    }

    // ── 路徑 A:貼上文字清單 → 比對客戶主檔 ──
    const lines: string[] = (Array.isArray(body.lines) ? body.lines : [])
      .map((l: string) => String(l).trim()).filter(Boolean)
    if (lines.length === 0) return NextResponse.json({ error: '清單是空的' }, { status: 400 })
    if (lines.length > 500) return NextResponse.json({ error: '單次最多 500 筆' }, { status: 400 })
    const dryRun = body.dryRun !== false // 預設 dry-run,明確傳 false 才寫入

    // 建立比對索引(兩個都有快取,不會重掃)。
    // id='_preview' = 名單尚未建立的純比對預覽(建立名單 modal 用),跳過既有成員查詢。
    const isPreview = params.id === '_preview'
    if (isPreview && !dryRun) return NextResponse.json({ error: '_preview 只能 dryRun' }, { status: 400 })
    const [all, withCodes, existing] = await Promise.all([
      getAllSystemCustomers(),
      getCustomersWithCodes(),
      isPreview ? Promise.resolve([]) : listMembers(params.id),
    ])
    const byName = new Map<string, { id: string; name: string; salesperson: string }[]>()
    for (const c of all) {
      const k = norm(c.name)
      if (!byName.has(k)) byName.set(k, [])
      byName.get(k)!.push({ id: c.id, name: c.name, salesperson: c.salesperson })
    }
    const byCode = new Map(withCodes.filter((c) => c.institutionCode).map((c) => [c.institutionCode.trim(), c]))
    const already = new Set(existing.map((m) => m.customerId.replace(/-/g, '')))

    const matched: { input: string; customerId: string; name: string; salesperson: string }[] = []
    const duplicated: string[] = []   // 已在名單內
    const ambiguous: { input: string; candidates: string[] }[] = []
    const unmatched: string[] = []
    const seen = new Set<string>()    // 同一次貼上內去重

    for (const line of lines) {
      let hit: { id: string; name: string; salesperson: string } | null = null
      if (looksLikeCode(line)) {
        const c = byCode.get(line.trim())
        if (c) hit = { id: c.id, name: c.name, salesperson: '' }
      }
      if (!hit) {
        const cands = byName.get(norm(line)) ?? []
        if (cands.length === 1) hit = cands[0]
        else if (cands.length > 1) { ambiguous.push({ input: line, candidates: cands.map((c) => c.name) }); continue }
      }
      if (!hit) { unmatched.push(line); continue }
      const key = hit.id.replace(/-/g, '')
      if (seen.has(key)) continue
      seen.add(key)
      if (already.has(key)) { duplicated.push(hit.name); continue }
      matched.push({ input: line, customerId: hit.id, name: hit.name, salesperson: hit.salesperson })
    }

    if (dryRun) {
      return NextResponse.json({ dryRun: true, matched, duplicated, ambiguous, unmatched })
    }

    const created = await addMembers(params.id, matched)
    await logAuditEvent({
      module: 'bd', action: 'create', entityType: 'campaign-members',
      entityId: params.id, summary: `名單匯入成員 ${created} 筆(未比中 ${unmatched.length})`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { created, unmatched },
    }).catch(() => {})

    return NextResponse.json({ dryRun: false, created, duplicated, ambiguous, unmatched })
  } catch (error) {
    console.error('members import error:', error)
    return NextResponse.json({ error: '匯入失敗' }, { status: 500 })
  }
})
