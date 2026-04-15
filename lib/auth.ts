import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { getSystemUserByCredentials, allPermissions } from './system-notion'
import type { UserPermissions } from './system-notion'

type AppUser = {
  id: string
  username: string
  password: string
  name: string
  role: string
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

        // 1. Try Notion users DB first
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
              permissions: isAdmin ? allPermissions() : notionUser.permissions,
            } as any
          }
        } catch (e) {
          console.warn('Notion auth unavailable, falling back to env users:', e)
        }

        // 2. Fall back to env-based users (always treated as admin)
        const users = parseAppUsers()
        const matched = users.find(
          (u) => u.username === credentials.username && u.password === credentials.password
        )
        if (!matched) return null
        return { id: matched.id, name: matched.name, role: matched.role } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role ?? 'viewer'
        token.permissions = (user as any).permissions ?? undefined
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).role = typeof token.role === 'string' ? token.role : 'viewer'
        ;(session.user as any).permissions = (token.permissions as UserPermissions | undefined) ?? undefined
      }
      return session
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
}
