import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAuditEvent, getAuditActor } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false })

  try {
    const { pathname, title } = await req.json()

    logAuditEvent({
      module: 'navigation',
      action: 'view',
      entityType: 'page',
      entityId: pathname ?? '',
      entityTitle: title ?? pathname ?? '',
      summary: `瀏覽：${title ?? pathname ?? ''}`,
      actor: getAuditActor(session),
      request: { method: 'GET', path: pathname ?? '' },
    }).catch((e) => console.error('audit pageview error:', e))
  } catch {
    // silent — never block navigation
  }

  return NextResponse.json({ ok: true })
}
