import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from './auth'
import type { ModuleKey, UserPermissions } from './system-notion'

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

export async function requireViewPermission(module: ModuleKey) {
  const session = await requireSession()
  if (!canView(session, module)) redirect('/dashboard')
  return session
}
