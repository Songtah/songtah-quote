'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import type { ModuleKey, UserPermissions } from '@/lib/system-notion'
import { fadeUp } from '@/lib/motion'
import { FontSizeToggle } from '@/components/FontSizeToggle'

type SessionUserLike = {
  role?: string
  accountType?: string
  permissions?: UserPermissions
}

// ── Page title mapping for audit log ─────────────────────────
function getPageTitle(pathname: string): string {
  const exact: Record<string, string> = {
    '/dashboard':         '首頁總覽',
    '/customers':         '客戶管理',
    '/tickets':           '技術支援工單列表',
    '/bd':                '業務開發',
    '/products/catalog':  '產品管理',
    '/assets':            '品牌素材庫',
    '/quote/new':         '新增報價單',
    '/quotes':            '報價單管理',
    '/settings/accounts': '帳號管理',
    '/settings/audit':    '操作紀錄',
    '/admin':             '行政管理',
    '/admin/clinic-monitor': '客戶資料監控',
    '/admin/trip-planner':   '行程規劃',
    '/orders':            '訂貨單管理',
    '/orders/new':        '新增訂貨單',
    '/promotions':        '促銷活動',
  }
  if (exact[pathname]) return exact[pathname]
  if (/^\/customers\//.test(pathname)) return '客戶詳情'
  if (/^\/tickets\//.test(pathname)) return '技術支援工單詳情'
  if (/^\/quote\//.test(pathname)) return '報價單詳情'
  if (/^\/quotes/.test(pathname)) return '報價單管理'
  if (/^\/share\//.test(pathname)) return '報價單分享頁'
  if (/^\/orders\//.test(pathname)) return '訂貨單詳情'
  return pathname
}

type NavItem = {
  href: string
  label: string
  module: ModuleKey | null
  adminOnly?: boolean
  adminOrStaff?: boolean   // visible to admin OR 行政 accountType
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',         label: '首頁',     module: null },
  { href: '/customers',         label: '客戶',      module: 'crm' },
  { href: '/tickets',           label: '技術支援', module: 'rma' },
  { href: '/bd',                label: '業務開發', module: 'bd' },
  { href: '/products/catalog',  label: '產品',     module: 'products' },
  { href: '/quotes',            label: '報價',     module: 'quote' },
  { href: '/orders',            label: '訂貨',     module: 'orders' },
  { href: '/promotions',        label: '促銷活動', module: 'promotions' },
  { href: '/assets',            label: '素材庫',   module: 'assets' },
  { href: '/admin',                  label: '行政管理', module: 'admin', adminOrStaff: true },
  { href: '/admin/clinic-monitor',   label: '客戶資料監控', module: 'clinic_monitor' },
  { href: '/admin/trip-planner',     label: '行程規劃',     module: 'trip_planner' },
  { href: '/settings/accounts', label: '帳號權限', module: 'accounts' },
  { href: '/settings/audit',    label: '操作紀錄', module: null, adminOnly: true },
]

function canViewModule(
  role: string | undefined,
  permissions: UserPermissions | undefined,
  module: ModuleKey | null,
  sessionLoading: boolean
): boolean {
  if (module === null) return true          // 首頁永遠顯示
  if (sessionLoading) return false          // session 尚未載入，先隱藏所有模組
  if (role === 'admin') return true         // admin 看全部
  if (!permissions) return true            // env 帳號（無 permissions）= admin
  return permissions[module]?.view ?? false
}

export function AppShell({
  title,
  description,
  children,
  hidePhaseNote,
  sessionUser,
}: {
  title: string
  description: string
  children: React.ReactNode
  hidePhaseNote?: boolean
  sessionUser?: SessionUserLike
}) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const sessionLoading = status === 'loading' && !sessionUser
  const role        = ((session?.user as any)?.role        as string | undefined) ?? sessionUser?.role
  const accountType = ((session?.user as any)?.accountType as string | undefined) ?? sessionUser?.accountType
  const permissions = ((session?.user as any)?.permissions as UserPermissions | undefined) ?? sessionUser?.permissions

  // ── Page-view audit (fire-and-forget) ──────────────────────
  const lastLoggedPath = useRef('')
  useEffect(() => {
    // Only log after session is loaded and path actually changed
    if (status !== 'authenticated') return
    if (pathname === lastLoggedPath.current) return
    lastLoggedPath.current = pathname

    fetch('/api/audit-pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname, title: getPageTitle(pathname) }),
    }).catch(() => {}) // silent — never block the UI
  }, [pathname, status])

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && role !== 'admin') return false
    if (item.adminOrStaff && role !== 'admin' && accountType !== '行政') return false
    return canViewModule(role, permissions, item.module, sessionLoading)
  })

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 overflow-x-hidden">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 py-2.5 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href="/dashboard" className="shrink-0">
              <Image
                src="/Logo.svg"
                alt="崧達企業 — 回首頁"
                width={520}
                height={78}
                className="h-auto w-[80px] shrink-0 object-contain sm:w-28 md:w-36"
              />
            </Link>
            <div className="hidden sm:block h-6 w-px bg-gray-200 shrink-0" />
            <div className="hidden sm:block min-w-0">
              <p className="eyebrow text-[10px]">SONGTAH TRADING CO.,LTD.</p>
              <h1 className="truncate text-base font-semibold text-gray-900">{title}</h1>
            </div>
            {/* Mobile: show current page title next to logo */}
            <span className="sm:hidden text-sm font-semibold text-gray-800 truncate max-w-[140px]">{title}</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <FontSizeToggle />
            <Link href="/api/auth/signout" className="button-secondary px-[10px] py-[6px] text-[12px] sm:text-sm sm:px-3 sm:py-1.5">
              登出
            </Link>
          </div>
        </div>
        {/* Nav — horizontally scrollable on mobile, pill style */}
        <div className="mx-auto max-w-7xl px-3 sm:px-6 pb-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <nav className="inline-flex min-w-max bg-gray-100 rounded-full px-1 py-1 gap-0.5">
            {visibleItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-3 sm:px-4 py-2 sm:py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  (pathname === item.href ||
                    (item.href === '/quotes'                && pathname.startsWith('/quote')) ||
                    (item.href === '/orders'                && pathname.startsWith('/orders')) ||
                    (item.href === '/admin/clinic-monitor'  && pathname.startsWith('/admin/clinic-monitor')) ||
                    (item.href === '/admin/trip-planner'    && pathname.startsWith('/admin/trip-planner')) ||
                    (item.href === '/admin'                 && pathname.startsWith('/admin') && !pathname.startsWith('/admin/clinic-monitor') && !pathname.startsWith('/admin/trip-planner')) ||
                    (item.href === '/products/catalog'      && pathname.startsWith('/products')))
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-8">
        <motion.div key={pathname} variants={fadeUp} initial="hidden" animate="show">
          <div className="mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{title}</h2>
            <p className="muted mt-1 max-w-3xl text-sm sm:text-base">{description}</p>
          </div>
          {children}
        </motion.div>
      </main>
    </div>
  )
}
