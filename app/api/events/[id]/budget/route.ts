/**
 * /api/events/[id]/budget —— 活動預算核銷
 *   GET                                   預算項目＋支出＋彙總＋目前帳號可做的動作
 *   POST   { type:'item'|'expense', ... }  新增預算項目／支出（草稿）
 *   PATCH  { type:'item', id, ... }        修改預算項目
 *          { type:'expense', id, ... }     修改支出內容（僅草稿、已退回）
 *          { type:'expense', id, action, note? }  送審／撤回／核准／退回／標記已付款（lib/event-budget-model 的狀態機）
 *   DELETE ?type=item|expense&id=          刪除預算項目／草稿支出
 *
 * 入口權限：活動管理檢視／編輯。核准與付款另依帳號類型檢查（expenseRoles），不是有編輯權限就能核准。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { canEdit } from '@/lib/permissions'
import { getEventById } from '@/lib/notion/events'
import { listBudget, addBudgetItem, updateBudgetItem, deleteBudgetItem, addExpense, updateExpense, deleteExpense, transitionExpense } from '@/lib/db/event-budget'
import { summarizeBudget, expenseRoles, EXPENSE_TRANSITIONS, type ExpenseAction } from '@/lib/event-budget-model'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
type Ctx = { params: { id: string } }
const fail = (e: any, fallback: string) => NextResponse.json({ error: e?.message ?? fallback }, { status: 400 })

export const GET = withApiAuth({ module: 'events', action: 'view' }, async (_req: NextRequest, { params }: Ctx, session) => {
  const data = await listBudget(params.id)
  return NextResponse.json({ ...data, summary: summarizeBudget(data.items, data.expenses), roles: expenseRoles(session.user as any, canEdit(session, 'events')) })
})

export const POST = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, { params }: Ctx, session) => {
  const body = await req.json().catch(() => null)
  const event = await getEventById(params.id)
  if (!event) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  try {
    if (body?.type === 'item') return NextResponse.json({ item: await addBudgetItem(params.id, body) })
    if (body?.type === 'expense') return NextResponse.json({ expense: await addExpense(params.id, body, (session.user as any)?.name ?? '') })
    return NextResponse.json({ error: '不明的類型' }, { status: 400 })
  } catch (e) { return fail(e, '新增失敗') }
})

export const PATCH = withApiAuth({ module: 'events', action: 'view' }, async (req: NextRequest, { params }: Ctx, session) => {
  const body = await req.json().catch(() => null)
  const roles = expenseRoles(session.user as any, canEdit(session, 'events'))
  const by = (session.user as any)?.name ?? ''
  try {
    if (body?.type === 'item') {
      if (!roles.editor) return NextResponse.json({ error: '權限不足' }, { status: 403 })
      const item = await updateBudgetItem(params.id, String(body.id ?? ''), body)
      return item ? NextResponse.json({ item }) : NextResponse.json({ error: '找不到這個預算項目' }, { status: 404 })
    }
    if (body?.type !== 'expense') return NextResponse.json({ error: '不明的類型' }, { status: 400 })
    const id = String(body.id ?? '')
    if (body.action) {
      const action = body.action as ExpenseAction
      const rule = EXPENSE_TRANSITIONS[action]
      if (!rule) return NextResponse.json({ error: '不明的動作' }, { status: 400 })
      if (!roles[rule.actor]) return NextResponse.json({ error: `你的帳號不能${rule.label}` }, { status: 403 })
      const { before, after } = await transitionExpense(params.id, id, action, by, typeof body.note === 'string' ? body.note : '')
      logAuditEvent({
        module: 'events', action: 'update', entityType: 'event-expense', entityId: id, entityTitle: after.description,
        summary: `活動支出${rule.label}：${after.description} NT$ ${after.amount.toLocaleString('zh-TW')}（${before.status} → ${after.status}）`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
      }).catch(() => {})
      return NextResponse.json({ expense: after })
    }
    if (!roles.editor) return NextResponse.json({ error: '權限不足' }, { status: 403 })
    return NextResponse.json({ expense: await updateExpense(params.id, id, body) })
  } catch (e) { return fail(e, '更新失敗') }
})

export const DELETE = withApiAuth({ module: 'events', action: 'edit' }, async (req: NextRequest, { params }: Ctx) => {
  const type = req.nextUrl.searchParams.get('type'), id = req.nextUrl.searchParams.get('id') ?? ''
  try {
    if (type === 'item') return (await deleteBudgetItem(params.id, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '找不到這個預算項目' }, { status: 404 })
    if (type === 'expense') { await deleteExpense(params.id, id); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ error: '不明的類型' }, { status: 400 })
  } catch (e) { return fail(e, '刪除失敗') }
})
