'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { ModuleKey, UserPermissions } from '@/lib/system-notion'

type NavItem = {
  href: string
  label: string
  module: ModuleKey | null
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',         label: '首頁',    module: null },
  { href: '/customers',         label: 'CRM',     module: 'crm' },
  { href: '/tickets',           label: 'RMA',     module: 'rma' },
  { href: '/bd',                label: 'BD',      module: 'bd' },
  { href: '/products',          label: '產品',    module: 'products' },
  { href: '/quote/new',         label: '報價',    module: 'quote' },
  { href: '/settings/accounts', label: '帳號權限', module: 'accounts' },
]

function canViewModule(
  role: string | undefined,
  permissions: UserPermissions | undefined,
  module: ModuleKey | null
): boolean {
  if (module === null) return true
  if (role === 'admin') return true
  if (!permissions) return true
  return permissions[module]?.view ?? false
}

export function AppShell({
  title,
  description,
  children,
  hidePhaseNote,
}: {
  title: string
  description: string
  children: React.ReactNode
  hidePhaseNote?: boolean
}) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = (session?.user as any)?.role as string | undefined
  const permissions = (session?.user as any)?.permissions as UserPermissions | undefined

  const visibleItems = NAV_ITEMS.filter((item) => canViewModule(role, permissions, item.module))

  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-100 via-cream-50 to-brand-50 text-stone-800">
      <header className="sticky top-0 z-20 border-b border-brand-200/40 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <Image
              src="/Logo.svg"
              alt="崧達企業"
              width={520}
              height={78}
              className="h-auto w-28 object-contain md:w-36"
            />
            <div className="hidden sm:block h-8 w-px bg-brand-200/60" />
            <div className="min-w-0">
              <p className="eyebrow text-[10px]">SONGTAH TRADING CO LTD</p>
              <h1 className="truncate text-lg font-bold text-stone-800">{title}</h1>
            </div>
          </div>
          <Link href="/api/auth/signout" className="button-secondary rounded-full px-4 py-2">
            登出
          </Link>
        </div>
        {/* Gold accent line under header */}
        <div className="gold-line" />
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-6 py-3">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                pathname === item.href
                  ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_8px_20px_-8px_rgba(184,149,106,0.5)]'
                  : 'bg-white/80 text-stone-500 ring-1 ring-brand-200/50 hover:bg-brand-50 hover:text-stone-800 hover:ring-brand-300/60'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className={`soft-grid mb-8 rounded-2xl border border-brand-200/40 bg-white/80 p-8 shadow-[0_16px_48px_-16px_rgba(90,66,51,0.12)] backdrop-blur-sm ${hidePhaseNote ? '' : 'grid gap-4 md:grid-cols-[1.4fr_0.8fr]'}`}>
          <div>
            <p className="eyebrow mb-2">內部營運平台</p>
            <h2 className="text-3xl font-black tracking-tight text-stone-800">{title}</h2>
            <div className="gold-line mt-3 w-16" />
            <p className="muted mt-3 max-w-3xl">{description}</p>
          </div>
          {!hidePhaseNote && (
            <div className="rounded-2xl bg-gradient-to-br from-stone-800 to-stone-900 p-5 text-sm text-stone-100 shadow-[0_16px_40px_-16px_rgba(90,66,51,0.3)]">
              <p className="font-semibold text-brand-300">目前階段</p>
              <p className="mt-2 leading-7 text-stone-300">
                先以 Notion 為主資料來源，網站先完成入口、列表、權限骨架與報價流程，
                後續再逐步補上即時同步、案件處理與簽名流程。
              </p>
            </div>
          )}
        </section>
        {children}
      </main>
    </div>
  )
}
