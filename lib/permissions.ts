import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from './auth'
import type { ModuleKey, UserPermissions } from './notion/permissions-model'

export async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return session
}

function isAdmin(session: Awaited<ReturnType<typeof requireSession>>) {
  return (session.user as any)?.role === 'admin'
}

function getPerms(session: Awaited<ReturnType<typeof requireSession>>): UserPermissions | undefined {
  return (session.user as any)?.permissions
}

export function canView(session: Awaited<ReturnType<typeof requireSession>>, module: ModuleKey): boolean {
  if (isAdmin(session)) return true
  const perms = getPerms(session)
  if (!perms) return true // env-based users without explicit perms → allow all
  return perms[module]?.view ?? false
}

export function canEdit(session: Awaited<ReturnType<typeof requireSession>>, module: ModuleKey): boolean {
  if (isAdmin(session)) return true
  const perms = getPerms(session)
  if (!perms) return true
  return perms[module]?.edit ?? false
}

export function isCentralManagement(session: Awaited<ReturnType<typeof requireSession>>): boolean {
  // admin 放行:與 api-auth 的 central-management 規則一致(admin=系統最高權限;
  // 並避免 env admin 舊 JWT 缺 accountType 時整個產品後台被鎖)。
  const u = session.user as any
  return u?.role === 'admin' || u?.accountType === '中央管理'
}

export async function requireViewPermission(module: ModuleKey) {
  const session = await requireSession()
  if (!canView(session, module)) redirect('/dashboard')
  return session
}

export async function requireAdmin() {
  const session = await requireSession()
  if ((session.user as any)?.role !== 'admin') redirect('/dashboard')
  return session
}
