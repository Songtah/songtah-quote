/**
 * POST /api/customers/reassign — 業務離職:把某業務的客戶按鄉鎮市區整包轉給接手業務
 *
 * 權限:限 admin / 中央管理 / 總經理。
 * body: { from, moves: [{ city, district, to }], dryRun? }
 *   - from:離職(原)業務;moves:每個鄉鎮市區指定一個接手業務(to='' 或 '__release__' 釋出為未分派)
 *   - dryRun(預設 true):只回各區實際筆數,不寫入。
 *
 * 安全鐵律:只改「負責業務仍等於 from」的客戶(reassignSalesperson 逐筆重驗);
 * from 以外的任何客戶(別的業務/公司/盤商/空白)一律不碰。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listCustomersByArea, reassignSalesperson } from '@/lib/notion/customers'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const RELEASE = '__release__' // 釋出為未分派(負責業務清空)

export const POST = withApiAuth({ roles: ['中央管理', '總經理'] }, async (req: NextRequest, _ctx, session) => {
  try {
    const b = await req.json()
    const from = (b.from ?? '').trim()
    const moves: { city: string; district: string; to: string }[] = Array.isArray(b.moves) ? b.moves : []
    if (!from) return NextResponse.json({ error: '缺少離職業務' }, { status: 400 })
    if (moves.length === 0) return NextResponse.json({ error: '未指定任何轄區轉移' }, { status: 400 })
    const dryRun = b.dryRun !== false

    const targetNames = Array.from(new Set(moves.map((move) => move.to).filter((name) => name && name !== RELEASE)))
    if (targetNames.length > 0) {
      const users = await getSystemUsers()
      for (const targetName of targetNames) {
        const matches = users.filter((user) => user.name === targetName)
        if (matches.length !== 1 || !canAcceptNewBusiness(matches[0])) {
          return NextResponse.json({ error: `${targetName} 目前不承接新客戶` }, { status: 400 })
        }
      }
    }

    // 逐區撈「該區、負責業務=from」的客戶
    const perMove = await Promise.all(moves.map(async (m) => {
      const list = await listCustomersByArea({ city: m.city, district: m.district, salesperson: from })
      return { ...m, ids: list.map((c) => c.id), count: list.length }
    }))

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        total: perMove.reduce((s, m) => s + m.count, 0),
        moves: perMove.map((m) => ({ city: m.city, district: m.district, to: m.to, count: m.count })),
      })
    }

    let totalReassigned = 0, totalSkipped = 0
    const detail: { area: string; to: string; reassigned: number; skipped: number }[] = []
    for (const m of perMove) {
      if (m.ids.length === 0) continue
      const to = !m.to || m.to === RELEASE ? null : m.to
      const { reassigned, skipped } = await reassignSalesperson(m.ids, from, to)
      totalReassigned += reassigned; totalSkipped += skipped.length
      detail.push({ area: m.city + m.district, to: to ?? '(釋出未分派)', reassigned, skipped: skipped.length })
    }

    await logAuditEvent({
      module: 'crm', action: 'update', entityType: 'salesperson-handover',
      entityId: from,
      summary: `業務離職轉移:${from} 的客戶按 ${detail.length} 區轉出,共 ${totalReassigned} 家(跳過 ${totalSkipped})`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { from, detail },
    }).catch(() => {})

    return NextResponse.json({ dryRun: false, totalReassigned, totalSkipped, detail })
  } catch (error) {
    console.error('reassign error:', error)
    return NextResponse.json({ error: '轉移失敗' }, { status: 500 })
  }
})
