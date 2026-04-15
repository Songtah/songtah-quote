import 'next-auth'
import 'next-auth/jwt'
import type { UserPermissions } from '@/lib/system-notion'

declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null
      email?: string | null
      image?: string | null
      role?: string
      permissions?: UserPermissions
    }
  }

  interface User {
    role?: string
    permissions?: UserPermissions
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string
    permissions?: UserPermissions
  }
}
