/**
 * 統一 API 授權閘道（withApiAuth）
 *
 * 取代各 route 內散落的 `getServerSession` + `if(!session)` + 角色判斷。
 * 用宣告式規則包住 handler——身分/權限不通過就回 401/403，通過才執行 handler，
 * 並把已驗證的 session 當第三個參數交給 handler 使用。
 *
 * 規則種類：
 *   'session'                          只要登入即可
 *   'admin'                            role === 'admin'
 *   'central-management'               accountType === '中央管理'
 *   { roles: [...] }                   role==='admin' 或 accountType ∈ roles
 *   { module, action: 'view'|'edit' }  依模組權限（沿用 lib/permissions 的 canView/canEdit）
 *
 * 用法：
 *   export const POST = withApiAuth({ module: 'crm', action: 'edit' },
 *     async (req, { params }, session) => { ... })
 */
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { canView, canEdit } from '@/lib/permissions'
import type { ModuleKey } from '@/lib/notion/permissions-model'

export type ApiAuthRule =
  | 'session'
  | 'admin'
  | 'central-management'
  | { roles: string[] }
  | { module: ModuleKey; action: 'view' | 'edit' }

function passes(session: Session, rule: ApiAuthRule): boolean {
  const user = session.user as any
  if (rule === 'session') return true
  if (rule === 'admin') return user?.role === 'admin'
  if (rule === 'central-management') return user?.accountType === '中央管理'
  if ('roles' in rule) return user?.role === 'admin' || rule.roles.includes(user?.accountType)
  if ('module' in rule) {
    return rule.action === 'edit' ? canEdit(session, rule.module) : canView(session, rule.module)
  }
  return false
}

export function withApiAuth<Ctx = unknown>(
  rule: ApiAuthRule,
  handler: (req: NextRequest, ctx: Ctx, session: Session) => Promise<Response> | Response,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })
    if (!passes(session, rule)) return NextResponse.json({ error: '權限不足' }, { status: 403 })
    return handler(req, ctx, session)
  }
}
