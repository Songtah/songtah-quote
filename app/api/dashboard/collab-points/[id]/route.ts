/**
 * PATCH /api/dashboard/collab-points/[id] — 協作積分狀態流轉
 *
 * 依《業務客戶分區管理辦法 2026v4》第八章：
 *   助攻者提出（待確認）→ 受助業務確認（已確認）→ 總經理認列（已認列）
 *
 * TRANSITIONS 是唯一允許的狀態轉換來源，比照報價單狀態機的做法：
 * 新增動作要先在這張表加規則，不可繞過直接呼叫 updateCollabPointStatus。
 * 每一步都有「誰能做」的限制——確認只能由受助業務本人，認列只能由總經理／管理層，
 * 避免助攻者自己一路把自己的分數推到認列。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  getCollabPoint, updateCollabPointStatus, listCollabPoints,
  type CollabStatus,
} from '@/lib/notion/collab-points'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Actor = 'helped' | 'manager'

/** 目標狀態 → { 允許的來源狀態, 誰可以執行 } */
const TRANSITIONS: Record<CollabStatus, { from: CollabStatus[]; actor: Actor } | null> = {
  待確認: null,                                    // 只能由 POST 建立時產生
  已確認: { from: ['待確認'], actor: 'helped' },     // 受助業務確認助攻屬實
  已認列: { from: ['已確認'], actor: 'manager' },    // 總經理於業務會議認列
  駁回:   { from: ['待確認', '已確認'], actor: 'helped' },
}

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase('zh-TW') === b.trim().toLocaleLowerCase('zh-TW')
}

export const PATCH = withApiAuth({ module: 'bd', action: 'edit' }, async (
  req: NextRequest, ctx: { params: { id: string } }, session,
) => {
  try {
    const user = session.user as any
    const me = session.user?.name?.trim() ?? ''
    const isManager = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'

    const body = await req.json()
    const target = String(body.status ?? '') as CollabStatus
    const rule = TRANSITIONS[target]
    if (!rule) return NextResponse.json({ error: '不支援的狀態轉換' }, { status: 400 })

    const log = await getCollabPoint(ctx.params.id)
    if (!log) return NextResponse.json({ error: '找不到這筆協作積分' }, { status: 404 })

    if (!rule.from.includes(log.status as CollabStatus)) {
      return NextResponse.json(
        { error: `「${log.status}」不能直接轉為「${target}」` }, { status: 409 },
      )
    }

    // 誰可以執行：管理層可代行受助業務的確認/駁回，但認列只有管理層能做
    if (rule.actor === 'helped' && !isManager && !sameName(log.helped, me)) {
      return NextResponse.json({ error: '只有受助業務本人可以確認或駁回' }, { status: 403 })
    }
    if (rule.actor === 'manager' && !isManager) {
      return NextResponse.json({ error: '認列須由總經理或管理層執行' }, { status: 403 })
    }

    // 辦法：同一案件的協作積分原則僅認列一次。有填案件識別才擋得住，
    // 沒填就無從判重（辦法也允許總經理認定重大協助可再次計分，故不硬性阻擋建立）。
    if (target === '已認列' && log.caseKey) {
      const sameCase = (await listCollabPoints({ status: '已認列' }))
        .filter((other) => other.id !== log.id && other.caseKey === log.caseKey && sameName(other.helper, log.helper))
      if (sameCase.length > 0 && !body.overrideDuplicate) {
        return NextResponse.json({
          error: `案件「${log.caseKey}」已認列過協作積分，同一案件原則僅認列一次。若總經理認定為不同階段的重大協助，請確認後再送出。`,
          duplicate: true,
        }, { status: 409 })
      }
    }

    await updateCollabPointStatus(ctx.params.id, target)

    await logAuditEvent({
      module: 'bd',
      action: 'update',
      entityType: 'collab-point',
      entityId: log.id,
      entityTitle: log.title,
      summary: `協作積分 ${log.status} → ${target}（${log.helper} 助攻 ${log.helped}，${log.points} 點）`
        + (target === '已認列' && body.overrideDuplicate ? '；經認定為獨立貢獻，覆寫同案件重複檢查' : ''),
      actor: getAuditActor(session),
      request: getAuditRequestContext(req),
      before: { status: log.status },
      after: { status: target },
    }).catch(() => {})

    return NextResponse.json({ id: log.id, status: target })
  } catch (error: any) {
    console.error('collab-points PATCH error:', error)
    return NextResponse.json({ error: error?.message ?? '狀態更新失敗' }, { status: 500 })
  }
})
