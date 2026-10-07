/**
 * POST /api/bd/uncontacted/assign — 把未往來名單中「未分派」的機構指派給業務（陌生開發）
 *
 * 權限：admin／中央管理／總經理。
 * body: { ids: string[], salesperson: string, dryRun?: boolean(預設 true) }
 * 安全：
 *   - 只接受目前仍在未往來名單、且負責業務空白者；公司／盤商／已具名者一律跳過
 *     （公司持有的既有客戶請走 /api/customers/assign-company 的逐筆流程）
 *   - 寫入走 assignSalesperson（逐筆重讀、只寫空白）
 *   - 客情集合不可用時拒絕（否則可能把有拜訪過的客戶當陌生名單派出去）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listUncontacted } from '@/lib/notion/uncontacted'
import { assignSalesperson } from '@/lib/notion/customers'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_PER_REQUEST = 300

export const POST = withApiAuth({ roles: ['中央管理', '總經理'] }, async (req: NextRequest, _ctx, session) => {
  try {
    const b = await req.json()
    const ids: string[] = Array.isArray(b.ids) ? Array.from(new Set(b.ids.filter((x: unknown) => typeof x === 'string'))) : []
    const salesperson = (b.salesperson ?? '').trim()
    const dryRun = b.dryRun !== false
    if (ids.length === 0) return NextResponse.json({ error: '未選擇機構' }, { status: 400 })
    if (ids.length > MAX_PER_REQUEST) return NextResponse.json({ error: `一次最多 ${MAX_PER_REQUEST} 筆` }, { status: 400 })
    if (!salesperson) return NextResponse.json({ error: '未選擇要分派的業務' }, { status: 400 })

    const matches = (await getSystemUsers()).filter((u) => u.name === salesperson)
    if (matches.length !== 1 || !canAcceptNewBusiness(matches[0])) {
      return NextResponse.json({ error: `${salesperson} 目前不承接新客戶` }, { status: 400 })
    }

    const { items, visitedAvailable } = await listUncontacted()
    if (!visitedAvailable) {
      return NextResponse.json({ error: '客情紀錄集合尚未備妥（夜間排程未完成），暫時無法判斷是否往來過，請稍後再分派' }, { status: 409 })
    }
    const byId = new Map(items.map((r) => [r.id, r]))
    const eligible: string[] = []
    const rejected: { id: string; name: string; reason: string }[] = []
    for (const id of ids) {
      const r = byId.get(id)
      if (!r) { rejected.push({ id, name: '', reason: '已不在未往來名單（可能已有客情或已結案）' }); continue }
      if (r.salesperson) { rejected.push({ id, name: r.name, reason: `已有負責：${r.salesperson}` }); continue }
      eligible.push(id)
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, willAssign: eligible.length, rejected,
        sample: eligible.slice(0, 20).map((id) => { const r = byId.get(id)!; return { name: r.name, type: r.type, area: `${r.city}${r.district}` } }),
      })
    }
    if (eligible.length === 0) return NextResponse.json({ error: '沒有可分派的機構', rejected }, { status: 400 })

    const { assigned, skipped } = await assignSalesperson(eligible, salesperson)

    await logAuditEvent({
      module: 'crm', action: 'update', entityType: 'customer-assignment',
      entityId: `uncontacted|${salesperson}`,
      summary: `未往來名單分派：${assigned} 家 → ${salesperson}（跳過 ${skipped.length + rejected.length}）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { salesperson, assigned, skipped: skipped.length, rejected: rejected.length, ids: eligible },
    }).catch(() => {})

    return NextResponse.json({ dryRun: false, assigned, skipped: skipped.length + rejected.length, salesperson })
  } catch (error) {
    console.error('uncontacted assign error:', error)
    return NextResponse.json({ error: '分派失敗' }, { status: 500 })
  }
})
