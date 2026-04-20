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
  if (module === null) return true          // 首頁 always visible
  if (role === 'admin') return true         // admin sees all
  if (!permissions) return true            // no perms in session = env admin
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(21,128,61,0.08),transparent_28%),linear-gradient(180deg,#f8f4ea_0%,#eff4ef_54%,#e6eee8_100%)] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <Image
              src="/Logo.svg"
              alt="崧達企業"
              width={152}
              height={48}
              className="h-auto w-32 object-contain md:w-40"
            />
            <div className="min-w-0">
              <p className="eyebrow">Songtah Internal Suite</p>
              <h1 className="truncate text-lg font-bold text-slate-900">{title}</h1>
            </div>
          </div>
          <Link href="/api/auth/signout" className="button-secondary rounded-full px-4 py-2">
            登出
          </Link>
        </div>
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-6 pb-4">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                pathname === item.href
                  ? 'bg-slate-900 text-white shadow-[0_10px_25px_-15px_rgba(15,23,42,0.8)]'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-emerald-50 hover:text-emerald-900'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className={`soft-grid mb-8 rounded-[32px] border border-white/80 bg-white/72 p-8 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.5)] backdrop-blur ${hidePhaseNote ? '' : 'grid gap-4 md:grid-cols-[1.4fr_0.8fr]'}`}>
          <div>
            <p className="eyebrow mb-2">內部營運平台</p>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">{title}</h2>
            <p className="muted mt-3 max-w-3xl">{description}</p>
          </div>
          {!hidePhaseNote && (
            <div className="rounded-[28px] bg-[linear-gradient(160deg,#0f172a_0%,#1e293b_100%)] p-5 text-sm text-slate-100 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.8)]">
              <p className="font-semibold text-emerald-300">目前階段</p>
              <p className="mt-2 leading-7 text-slate-200">
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
