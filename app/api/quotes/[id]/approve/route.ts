import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getQuote, updateQuoteStatus } from '@/lib/notion'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  const user = session.user as any
  const role: string        = user?.role ?? ''
  const accountType: string = user?.accountType ?? ''

  const isAdmin    = role === 'admin'
  const isStaff    = accountType === '行政'
  const isGM       = accountType === '總經理'
  const canApprove = isAdmin || isStaff || isGM

  if (!canApprove) {
    return NextResponse.json({ error: '無簽核權限' }, { status: 403 })
  }

  let body: { action: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '無效請求' }, { status: 400 })
  }

  const { action, note = '' } = body

  // ── Resolve new status ──────────────────────────────────────
  let newStatus: string

  if (action === 'approve') {
    newStatus = '已核准'
  } else if (action === 'escalate') {
    // Only admin / 行政 may escalate
    if (!isAdmin && !isStaff) {
      return NextResponse.json({ error: '無權限呈總經理' }, { status: 403 })
    }
    newStatus = '待總經理審核'
  } else if (action === 'reject') {
    newStatus = '已退回'
  } else if (action === 'resubmit') {
    // Sales / owner can re-submit a rejected quote back to pending
    newStatus = '待行政審核'
  } else {
    return NextResponse.json({ error: '無效動作' }, { status: 400 })
  }

  const quote = await getQuote(params.id).catch(() => null)
  if (!quote) return NextResponse.json({ error: '找不到報價單' }, { status: 404 })

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
}
