'use client'

/**
 * 全站共用的側邊導覽與手機選單。
 *
 * 為什麼抽出來：/dashboard 原本自己刻了一份側邊欄，跟 AppShell 的那份長期各自演進，
 * 結果選單項目高度（py-2.5 vs py-3）、圖示大小（size-4 vs size-4.5）、背景色都不一樣，
 * 更嚴重的是首頁那份漏了「業績總覽」，管理層從首頁根本連不過去。
 * 導覽只留這一份實作，兩邊共用，才不會再漂移。
 */
import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { ModuleKey, UserPermissions } from '@/lib/system-notion'
import {
  BadgeDollarSign, BriefcaseBusiness, Building2, CircleUserRound, FileText,
  Headphones, Home, Menu, PackageCheck, Settings2, ShoppingBag, TrendingUp,
  UsersRound, X, type LucideIcon,
} from 'lucide-react'

export type SessionUserLike = {
  role?: string
  accountType?: string
  permissions?: UserPermissions
}

type NavGroup = '工作' | '交易' | '服務' | '管理'

export type NavItem = {
  href: string
  label: string
  group: NavGroup
  module: ModuleKey | null
  adminOnly?: boolean
  adminOrStaff?: boolean
  ceoOnly?: boolean
  icon: LucideIcon
}

const CEO_ACCOUNT_TYPES = new Set(['行政', '中央管理', '總經理'])

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: '首頁', group: '工作', module: null, icon: Home },
  { href: '/customers', label: '客戶', group: '工作', module: 'crm', icon: UsersRound },
  { href: '/bd', label: '業務開發', group: '工作', module: 'bd', icon: BriefcaseBusiness },
  { href: '/quotes', label: '報價', group: '交易', module: 'quote', icon: FileText },
  { href: '/orders', label: '訂貨', group: '交易', module: 'orders', icon: PackageCheck },
  { href: '/products/catalog', label: '產品與價格', group: '交易', module: 'products', icon: ShoppingBag },
  { href: '/tickets', label: '技術支援', group: '服務', module: 'rma', icon: Headphones },
  { href: '/marketing', label: '行銷與活動', group: '服務', module: null, icon: BadgeDollarSign },
  { href: '/admin/clinic-monitor', label: '市場監控', group: '服務', module: 'clinic_monitor', icon: Building2 },
  { href: '/dashboard/ceo', label: '業績總覽', group: '管理', module: null, ceoOnly: true, icon: TrendingUp },
  { href: '/admin', label: '行政管理', group: '管理', module: 'admin', adminOrStaff: true, icon: Settings2 },
  { href: '/settings/accounts', label: '帳號權限', group: '管理', module: 'accounts', icon: CircleUserRound },
  { href: '/settings/audit', label: '操作紀錄', group: '管理', module: null, adminOnly: true, icon: FileText },
]

function canViewModule(
  role: string | undefined,
  permissions: UserPermissions | undefined,
  module: ModuleKey | null,
  sessionLoading: boolean,
): boolean {
  if (module === null) return true          // 首頁永遠顯示
  if (sessionLoading) return false          // session 尚未載入，先隱藏所有模組
  if (role === 'admin') return true
  if (!permissions) return true             // env 帳號（無 permissions）= admin
  return permissions[module]?.view ?? false
}

/** 共用的可見項目計算，讓側邊欄與手機選單得到同一份結果 */
export function useVisibleNav(sessionUser?: SessionUserLike) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const sessionLoading = status === 'loading' && !sessionUser
  const role = ((session?.user as any)?.role as string | undefined) ?? sessionUser?.role
  const accountType = ((session?.user as any)?.accountType as string | undefined) ?? sessionUser?.accountType
  const permissions = ((session?.user as any)?.permissions as UserPermissions | undefined) ?? sessionUser?.permissions

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && role !== 'admin') return false
    if (item.adminOrStaff && role !== 'admin' && accountType !== '行政') return false
    if (item.ceoOnly && role !== 'admin' && !CEO_ACCOUNT_TYPES.has(accountType ?? '')) return false
    return canViewModule(role, permissions, item.module, sessionLoading)
  })

  const visibleGroups = (['工作', '交易', '服務', '管理'] as const)
    .map((group) => ({ group, items: visibleItems.filter((item) => item.group === group) }))
    .filter(({ items }) => items.length > 0)

  const isActive = (item: NavItem) => pathname === item.href ||
    (item.href === '/quotes' && pathname.startsWith('/quote')) ||
    (item.href === '/orders' && pathname.startsWith('/orders')) ||
    (item.href === '/admin/clinic-monitor' && pathname.startsWith('/admin/clinic-monitor')) ||
    (item.href === '/admin' && pathname.startsWith('/admin') && !pathname.startsWith('/admin/clinic-monitor') && !pathname.startsWith('/admin/trip-planner')) ||
    (item.href === '/products/catalog' && pathname.startsWith('/products'))

  return { visibleGroups, isActive, userName: session?.user?.name?.trim() || '我的帳號' }
}

/** 桌機固定側邊欄（lg 以上顯示）。寬度 w-60，對應 main 的 lg:ml-60。 */
export function AppSidebar({ sessionUser }: { sessionUser?: SessionUserLike }) {
  const { visibleGroups, isActive, userName } = useVisibleNav(sessionUser)
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-stone-900/[0.06] bg-[#fdfdfb] px-5 py-6 lg:flex">
      <Link href="/dashboard" className="mb-8 block px-2" aria-label="崧達企業 — 回首頁">
        <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-36" priority />
      </Link>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1" aria-label="主要導覽">
        {visibleGroups.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-2 px-4 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">{group}</p>
            <div className="space-y-1">
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive(item) ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-all active:scale-95 ${
                      isActive(item)
                        ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                        : 'text-stone-500 hover:bg-white hover:text-brand-700 hover:shadow-sm'
                    }`}
                  >
                    <Icon className="size-4" /> {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-auto flex items-center justify-between gap-2 rounded-2xl bg-white px-3 py-3 shadow-sm ring-1 ring-stone-900/[0.04]">
        <span className="min-w-0 truncate text-xs font-semibold text-stone-500">{userName}</span>
        <Link href="/api/auth/signout" className="text-xs font-semibold text-stone-400 hover:text-brand-700">登出</Link>
      </div>
    </aside>
  )
}

/** 手機頂端列與展開選單（lg 以下顯示） */
export function AppMobileNav({ sessionUser }: { sessionUser?: SessionUserLike }) {
  const { visibleGroups, isActive } = useVisibleNav(sessionUser)
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-30 border-b border-stone-900/[0.06] bg-white/95 backdrop-blur-xl lg:hidden">
      <div className="flex h-16 items-center justify-between px-4">
        <Link href="/dashboard"><Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-28" priority /></Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-full bg-stone-100 p-3 text-stone-600 transition-all active:scale-95"
          aria-label={open ? '關閉選單' : '開啟選單'}
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav className="max-h-[70vh] overflow-y-auto border-t border-stone-900/[0.06] bg-white p-4" aria-label="手機主要導覽">
          {visibleGroups.map(({ group, items }) => (
            <div key={group} className="mb-4 last:mb-0">
              <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-stone-400">{group}</p>
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-12 items-center gap-2 rounded-2xl px-3 py-3 text-sm font-semibold active:scale-95 ${
                        isActive(item) ? 'bg-brand-500 text-white' : 'bg-stone-50 text-stone-600'
                      }`}
                    >
                      <Icon className="size-4" />{item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
          <Link href="/api/auth/signout" className="mt-2 flex items-center justify-center rounded-full bg-stone-100 px-4 py-3 text-sm font-semibold text-stone-500">登出</Link>
        </nav>
      )}
    </header>
  )
}

/** 手機底部快速導覽（lg 以下顯示）。固定四格：首頁／客戶／業務開發／報價。 */
export function AppBottomNav({ sessionUser }: { sessionUser?: SessionUserLike }) {
  const { visibleGroups, isActive } = useVisibleNav(sessionUser)
  const items = visibleGroups
    .flatMap(({ items }) => items)
    .filter((item) => ['/dashboard', '/customers', '/bd', '/quotes'].includes(item.href))
    .slice(0, 4)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-stone-900/[0.07] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden"
      aria-label="手機快速導覽"
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item) ? 'page' : undefined}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl py-1 text-[11px] font-semibold active:scale-95 ${
              isActive(item) ? 'text-brand-600' : 'text-stone-400'
            }`}
          >
            <Icon className="size-5" />{item.label}
          </Link>
        )
      })}
    </nav>
  )
}
