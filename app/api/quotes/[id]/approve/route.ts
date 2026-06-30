import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getQuote, updateQuoteStatus } from '@/lib/notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

// 簽核權限：admin / 行政 / 總經理（withApiAuth 先擋入口，內部再依目前狀態做轉換層級判斷）
export const POST = withApiAuth({ roles: ['行政', '總經理'] }, async (req: NextRequest, { params }: { params: { id: string } }, session) => {
  const user = session.user as any
  const role: string        = user?.role ?? ''
  const accountType: string = user?.accountType ?? ''

  const isAdmin    = role === 'admin'
  const isStaff    = accountType === '行政'
  const isGM       = accountType === '總經理'

  let body: { action: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '無效請求' }, { status: 400 })
  }

  const { action, note = '' } = body

  const quote = await getQuote(params.id).catch(() => null)
  if (!quote) return NextResponse.json({ error: '找不到報價單' }, { status: 404 })

  // ── 狀態機：依目前狀態決定合法的下一步，避免跳過總經理審核層級 ──────────────
  // 注意：每個 action 的目標狀態與允許角色都綁定「目前狀態」，不是只看 action 本身。
  type Transition = { to: string; roles: Array<'admin' | '行政' | '總經理'> }
  const TRANSITIONS: Record<string, Record<string, Transition>> = {
    '待行政審核': {
      approve:  { to: '已核准',     roles: ['admin', '行政'] },
      escalate: { to: '待總經理審核', roles: ['admin', '行政'] },
      reject:   { to: '已退回',     roles: ['admin', '行政', '總經理'] },
    },
    '待總經理審核': {
      // 已呈總經理者，只有總經理（或 admin）可核准——行政不可代為核准，避免繞過審核層級。
      approve: { to: '已核准', roles: ['admin', '總經理'] },
      reject:  { to: '已退回', roles: ['admin', '行政', '總經理'] },
    },
    '已退回': {
      resubmit: { to: '待行政審核', roles: ['admin', '行政', '總經理'] },
    },
    '已核准': {
      // 允許管理員撤銷誤核准的報價單，但不可由此狀態再「approve」（已是終態）。
      reject: { to: '已退回', roles: ['admin'] },
    },
  }

  const transition = TRANSITIONS[quote.status]?.[action]
  if (!transition) {
    return NextResponse.json(
      { error: `報價單目前狀態為「${quote.status}」，無法執行「${action}」` },
      { status: 400 }
    )
  }
  const actorRole = isAdmin ? 'admin' : isStaff ? '行政' : isGM ? '總經理' : ''
  if (!transition.roles.includes(actorRole as any)) {
    return NextResponse.json({ error: '無權限執行此簽核動作' }, { status: 403 })
  }

  const newStatus = transition.to

  await updateQuoteStatus(params.id, newStatus, note || undefined)

  await logAuditEvent({
    module: 'quote',
    action: 'update',
    entityType: 'quote',
    entityId: params.id,
    entityTitle: quote.quoteNumber,
    summary: `報價單 ${quote.quoteNumber} 簽核動作：${action} → ${newStatus}`,
    actor: getAuditActor(session),
    request: getAuditRequestContext(req),
    before: { status: quote.status },
    after:  { status: newStatus, approvalNote: note },
  }).catch((e) => console.error('audit approve error:', e))

  return NextResponse.json({ ok: true, status: newStatus })
})
