'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import type { ModuleKey, UserPermissions } from '@/lib/system-notion'
import { fadeUp } from '@/lib/motion'
import { AppSidebar, AppMobileNav, AppBottomNav, type SessionUserLike } from '@/components/AppNav'
import {
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  CircleUserRound,
  FileText,
  Headphones,
  Home,
  Menu,
  PackageCheck,
  Settings2,
  ShoppingBag,
  TrendingUp,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'

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
    '/dashboard/ceo':         '業績總覽',
    '/dashboard/performance': '我的業績明細',
    '/admin/trip-planner':   '行程規劃',
    '/orders':            '訂貨單管理',
    '/orders/new':        '新增訂貨單',
    '/promotions':        '促銷活動',
    '/events':            '活動管理',
    '/course-costs':      '辦課成本試算',
    '/marketing':         '行銷管理',
  }
  if (exact[pathname]) return exact[pathname]
  if (/^\/customers\//.test(pathname)) return '客戶詳情'
  if (/^\/tickets\//.test(pathname)) return '技術支援工單詳情'
  if (/^\/quote\//.test(pathname)) return '報價單詳情'
  if (/^\/quotes/.test(pathname)) return '報價單管理'
  if (/^\/share\//.test(pathname)) return '報價單分享頁'
  if (/^\/orders\//.test(pathname)) return '訂貨單詳情'
  if (/^\/events\//.test(pathname)) return '活動詳情'
  return pathname
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
  const userName = session?.user?.name?.trim() || '我的帳號'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-stone-800">
      <AppSidebar sessionUser={sessionUser} />
      <AppMobileNav sessionUser={sessionUser} />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 sm:px-7 sm:pt-8 lg:ml-60 lg:px-10 lg:pb-10">
        <motion.div key={pathname} variants={fadeUp} initial="hidden" animate="show">
          <div className="mb-6 sm:mb-8">
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-brand-500">{getPageTitle(pathname)}</p>
            <h1 className="text-2xl font-bold tracking-tight text-stone-800 sm:text-3xl">{title}</h1>
            {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-500 sm:text-base">{description}</p>}
          </div>
          {children}
        </motion.div>
      </main>

      <AppBottomNav sessionUser={sessionUser} />
    </div>
  )
}
