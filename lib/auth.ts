import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { getSystemUserByCredentials, allPermissions } from './system-notion'
import type { UserPermissions } from './system-notion'
import { logAuditEvent } from './audit'

type AppUser = {
  id: string
  username: string
  password: string
  name: string
  role: string
  accountType?: string
}

function parseAppUsers(): AppUser[] {
  const fromJson = process.env.APP_USERS_JSON
  if (fromJson) {
    try {
      const parsed = JSON.parse(fromJson) as AppUser[]
      if (Array.isArray(parsed)) {
        return parsed.filter((u) => u.username && u.password && u.name && u.role)
      }
    } catch (error) {
      console.warn('APP_USERS_JSON parse failed:', error)
    }
  }
  if (process.env.APP_USERNAME && process.env.APP_PASSWORD) {
    return [
      {
        id: 'legacy-user',
        username: process.env.APP_USERNAME,
        password: process.env.APP_PASSWORD,
        name: '崧達使用者',
        role: 'admin',
        accountType: '中央管理',
      },
    ]
  }
  return []
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: '帳號', type: 'text' },
        password: { label: '密碼', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null

        // 1. Always check env-based users first (admin accounts, always available)
        const envUsers = parseAppUsers()
        const envMatched = envUsers.find(
          (u) => u.username === credentials.username && u.password === credentials.password
        )
        if (envMatched) {
          return {
            id: envMatched.id,
            name: envMatched.name,
            role: envMatched.role,
            accountType: envMatched.accountType ?? (envMatched.role === 'admin' ? '中央管理' : ''),
          } as any
        }

        // 2. Try Notion users DB (accounts created via account management)
        try {
          const notionUser = await getSystemUserByCredentials(
            credentials.username,
            credentials.password
          )
          if (notionUser) {
            const isAdmin = notionUser.accountType === '中央管理'
            return {
              id: notionUser.id,
              name: notionUser.name,
              role: isAdmin ? 'admin' : 'user',
              accountType: notionUser.accountType,
              permissions: isAdmin ? allPermissions() : notionUser.permissions,
            } as any
          }
          // Notion is reachable but user/password not found
          return null
        } catch (e) {
          console.error('Notion auth error:', e)
          // Notion unavailable — only env users can log in
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = (user as any).id ?? token.sub
        token.role = (user as any).role ?? 'viewer'
        token.accountType = (user as any).accountType ?? ''
        token.permissions = (user as any).permissions ?? undefined
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = typeof token.uid === 'string' ? token.uid : token.sub
        ;(session.user as any).role = typeof token.role === 'string' ? token.role : 'viewer'
        ;(session.user as any).accountType = typeof token.accountType === 'string' ? token.accountType : ''
        ;(session.user as any).permissions = (token.permissions as UserPermissions | undefined) ?? undefined
      }
      return session
    },
  },
  events: {
    async signIn({ user }) {
      const u = user as any
      logAuditEvent({
        module: 'auth',
        action: 'login',
        entityType: 'user',
        entityId: u.id ?? '',
        entityTitle: u.name ?? '',
        summary: `登入：${u.name ?? '未知'}`,
        actor: { id: u.id, name: u.name ?? '未知', role: u.role ?? '' },
      }).catch((e) => console.error('audit login error:', e))
    },
    async signOut({ token }) {
      const name = typeof token?.name === 'string' ? token.name : '未知'
      const id = typeof (token as any)?.uid === 'string' ? (token as any).uid : ''
      const role = typeof (token as any)?.role === 'string' ? (token as any).role : ''
      logAuditEvent({
        module: 'auth',
        action: 'logout',
        entityType: 'user',
        entityId: id,
        entityTitle: name,
        summary: `登出：${name}`,
        actor: { id, name, role },
      }).catch((e) => console.error('audit logout error:', e))
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
}
