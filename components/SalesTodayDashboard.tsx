'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  ArrowRight,
  BriefcaseBusiness,
  CircleUserRound,
  ClipboardPlus,
  FileText,
  Headphones,
  Home,
  Menu,
  PackageCheck,
  Search,
  Settings2,
  ShoppingBag,
  UsersRound,
  X,
} from 'lucide-react'
import { AnimatedList } from '@/components/ui/animated-list'
import { MagicCard } from '@/components/ui/magic-card'
import { NumberTicker } from '@/components/ui/number-ticker'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import type { TodayDashboardData, TodayWorkItem } from '@/lib/dashboard-today'

type VisibleModules = Partial<Record<'bd' | 'crm' | 'quote' | 'orders' | 'products' | 'rma' | 'marketing' | 'clinicMonitor' | 'admin' | 'accounts' | 'audit', boolean>>

const navItems = [
  { href: '/dashboard', label: '今天', icon: Home, module: null },
  { href: '/customers', label: '客戶', icon: UsersRound, module: 'crm' as const },
  { href: '/bd', label: '業務開發', icon: BriefcaseBusiness, module: 'bd' as const },
  { href: '/quotes', label: '報價', icon: FileText, module: 'quote' as const },
  { href: '/orders', label: '訂貨', icon: PackageCheck, module: 'orders' as const },
  { href: '/products/catalog', label: '產品與價格', icon: ShoppingBag, module: 'products' as const },
  { href: '/tickets', label: '技術支援', icon: Headphones, module: 'rma' as const },
  { href: '/marketing', label: '行銷與活動', icon: BriefcaseBusiness, module: 'marketing' as const },
  { href: '/admin/clinic-monitor', label: '市場監控', icon: Search, module: 'clinicMonitor' as const },
  { href: '/admin', label: '行政管理', icon: Settings2, module: 'admin' as const },
  { href: '/settings/accounts', label: '帳號權限', icon: CircleUserRound, module: 'accounts' as const },
  { href: '/settings/audit', label: '操作紀錄', icon: FileText, module: 'audit' as const },
]

const quickActions = [
  { href: '/bd', label: '新增拜訪', icon: ClipboardPlus, module: 'bd' as const },
  { href: '/customers', label: '找客戶', icon: Search, module: 'crm' as const },
  { href: '/quote/new', label: '建立報價', icon: FileText, module: 'quote' as const },
  { href: '/orders', label: '查訂單', icon: PackageCheck, module: 'orders' as const },
  { href: '/tickets/new', label: '新增工單', icon: Headphones, module: 'rma' as const },
]

const kindLabel: Record<TodayWorkItem['kind'], string> = {
  visit: '拜訪',
  'follow-up': '追蹤',
  quote: '報價',
  ticket: '工單',
}

function displayDate(date: string) {
  const parsed = new Date(`${date}T12:00:00+08:00`)
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日 ${weekdays[parsed.getUTCDay()]}`
}

export function SalesTodayDashboard({
  userName,
  greeting,
  data,
  visibleModules,
}: {
  userName: string
  greeting: '早安' | '午安' | '晚安'
  data: TodayDashboardData
  visibleModules: VisibleModules
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const logged = useRef(false)

  useEffect(() => {
    if (logged.current) return
    logged.current = true
    fetch('/api/audit-pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname: '/dashboard', title: '首頁總覽' }),
    }).catch(() => {})
  }, [])

  const visibleNav = navItems.filter((item) => !item.module || visibleModules[item.module])
  const visibleActions = quickActions.filter((item) => visibleModules[item.module])
  const next = data.nextAction
  const summary = [
    { label: '今日拜訪', value: data.counts.visits, href: '/bd' },
    { label: '待追蹤', value: data.counts.followUps, href: '/bd' },
    { label: '進行中報價', value: data.counts.quotes, href: '/quotes' },
    { label: '逾期工單', value: data.counts.overdueTickets, href: '/tickets', danger: data.counts.overdueTickets > 0 },
  ].filter((item) => {
    if (item.href === '/bd') return visibleModules.bd
    if (item.href === '/quotes') return visibleModules.quote
    if (item.href === '/tickets') return visibleModules.rma
    return true
  })

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || !visibleModules.crm) return
    router.push(`/customers?q=${encodeURIComponent(value)}`)
  }

  return (
    <div className="min-h-screen bg-white text-stone-800">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-stone-900/[0.06] bg-[#fdfdfb] px-5 py-6 lg:flex">
        <Link href="/dashboard" className="mb-10 block px-2" aria-label="崧達首頁">
          <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-36" priority />
        </Link>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="主要導覽">
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={href === '/dashboard' ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold transition-all active:scale-95 ${
                href === '/dashboard'
                  ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                  : 'text-stone-500 hover:bg-white hover:text-brand-700 hover:shadow-sm'
              }`}
            >
              <Icon className="size-4.5" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-3 space-y-2">
          <button onClick={() => signOut({ callbackUrl: '/login' })} className="flex w-full items-center gap-3 rounded-full px-4 py-3 text-left text-sm text-stone-400 hover:bg-white hover:text-stone-700">
            <CircleUserRound className="size-4" /> {userName || '我的帳號'}・登出
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-stone-900/[0.06] bg-white/90 backdrop-blur-xl lg:hidden">
        <div className="flex h-16 items-center justify-between px-4">
          <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-28" priority />
          <button onClick={() => setMobileMenuOpen((open) => !open)} className="rounded-full bg-stone-100 p-3 text-stone-600 active:scale-95" aria-label={mobileMenuOpen ? '關閉選單' : '開啟選單'}>
            {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <nav className="grid grid-cols-2 gap-2 border-t border-stone-900/[0.06] bg-white p-4" aria-label="手機主要導覽">
            {visibleNav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 rounded-2xl bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-600 active:scale-95">
                <Icon className="size-4" /> {label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="pb-24 lg:ml-60 lg:pb-10">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7 sm:py-9 lg:px-10">
          <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-stone-400">{displayDate(data.date)}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-800 sm:text-3xl">{userName || '夥伴'}，{greeting}</h1>
            </div>
            {visibleModules.crm && (
              <form onSubmit={submitSearch} className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} className="input-soft h-12 w-full rounded-full pl-11 pr-4" placeholder="搜尋客戶名稱" aria-label="搜尋客戶名稱" />
              </form>
            )}
          </div>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,.75fr)]" aria-label="今天最重要的工作">
            <MagicCard gradientColor="#f2ede3" gradientFrom="#ead8b4" gradientTo="#efe4c8" gradientOpacity={0.45} className="rounded-3xl border-0 shadow-[0_20px_60px_rgba(87,74,48,0.10)]">
              <div className="relative z-30 min-h-[300px] bg-gradient-to-br from-[#fffdf8] via-[#fdfcf8] to-[#f8f1e3] p-6 sm:p-9">
                <div className="mb-10 flex items-center justify-between gap-4">
                  <span className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold tracking-wide text-emerald-700 shadow-sm">下一個動作</span>
                  {next?.overdue && <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600">已逾期</span>}
                </div>
                {next ? (
                  <>
                    <p className="text-sm font-semibold text-stone-500">{next.time}・{kindLabel[next.kind]}</p>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-stone-900 sm:text-4xl">{next.customer}</h2>
                    <p className="mt-3 max-w-xl text-base leading-7 text-stone-600 sm:text-lg">{next.action}</p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <ShimmerButton onClick={() => router.push(next.href)} background="#8a6c32" shimmerColor="#fff7df" className="h-12 px-6 text-sm font-bold shadow-lg shadow-brand-500/20 active:scale-95">
                        開始處理 <ArrowRight className="ml-2 size-4" />
                      </ShimmerButton>
                      {visibleModules.crm && (
                        <Link href={`/customers?q=${encodeURIComponent(next.customer)}`} className="rounded-full bg-white/80 px-6 py-3 text-center text-sm font-semibold text-stone-600 shadow-sm transition-all hover:bg-white active:scale-95">查看客戶資料</Link>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-stone-500">今天尚未安排工作</p>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-stone-900 sm:text-4xl">先從一位客戶開始</h2>
                    <p className="mt-3 text-base leading-7 text-stone-600">搜尋客戶或記錄拜訪，系統就會把下一步放到這裡。</p>
                    {(visibleModules.crm || visibleModules.bd) && (
                      <div className="mt-8">
                        <ShimmerButton onClick={() => router.push(visibleModules.crm ? '/customers' : '/bd')} background="#8a6c32" shimmerColor="#fff7df" className="h-12 px-6 text-sm font-bold shadow-lg shadow-brand-500/20 active:scale-95">
                          {visibleModules.crm ? '找客戶' : '前往業務開發'} <ArrowRight className="ml-2 size-4" />
                        </ShimmerButton>
                      </div>
                    )}
                  </>
                )}
              </div>
            </MagicCard>

            <div className="rounded-3xl bg-[#fdfdfb] p-6 shadow-[0_16px_50px_rgba(87,74,48,0.07)] sm:p-7">
              <h2 className="text-base font-bold text-stone-800">今天還有</h2>
              <div className="mt-5 divide-y divide-stone-900/[0.06]">
                {summary.map((item) => (
                  <Link key={`${item.href}-${item.label}`} href={item.href} className="flex items-center justify-between py-4 transition-colors hover:text-brand-700">
                    <span className="text-sm font-medium text-stone-500">{item.label}</span>
                    <span className={`text-2xl font-bold tabular-nums ${item.danger ? 'text-rose-600' : 'text-stone-800'}`}><NumberTicker value={item.value} className={item.danger ? 'text-rose-600' : 'text-stone-800'} /></span>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-8" aria-labelledby="up-next-title">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="up-next-title" className="text-lg font-bold text-stone-800">接下來的工作</h2>
              {visibleModules.bd && <Link href="/bd" className="text-sm font-semibold text-brand-600 hover:text-brand-700">查看全部</Link>}
            </div>
            {data.workItems.length > 0 ? (
              <AnimatedList delay={140} className="gap-3">
                {data.workItems.map((item) => (
                  <Link key={`${item.kind}-${item.id}`} href={item.href} className="group flex min-h-20 items-center gap-4 rounded-2xl bg-white px-4 py-4 shadow-[0_10px_35px_rgba(87,74,48,0.07)] ring-1 ring-stone-900/[0.04] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(87,74,48,0.11)] active:scale-[0.99] sm:px-6">
                    <span className={`w-20 shrink-0 text-sm font-bold ${item.overdue ? 'text-rose-600' : 'text-brand-600'}`}>{item.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-stone-800 sm:text-base">{item.customer}</span>
                      <span className="mt-0.5 block truncate text-sm text-stone-400">{item.action}</span>
                    </span>
                    <span className="hidden rounded-full bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500 sm:block">{kindLabel[item.kind]}</span>
                    <ArrowRight className="size-4 text-stone-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-500" />
                  </Link>
                ))}
              </AnimatedList>
            ) : (
              <div className="rounded-3xl bg-[#fdfdfb] px-6 py-10 text-center text-sm text-stone-400">目前沒有待辦工作，從下方快速建立一筆。</div>
            )}
          </section>

          {visibleActions.length > 0 && (
            <section className="mt-8" aria-labelledby="quick-actions-title">
              <h2 id="quick-actions-title" className="mb-4 text-lg font-bold text-stone-800">快速開始</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {visibleActions.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-[#fdfdfb] px-3 py-4 text-sm font-semibold text-stone-600 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:text-brand-700 hover:shadow-md active:scale-95">
                    <span className="rounded-full bg-white p-2.5 text-brand-600 shadow-sm"><Icon className="size-5" /></span>
                    {label}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-stone-900/[0.07] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden" aria-label="手機快速導覽">
        {visibleNav.slice(0, 4).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-semibold active:scale-95 ${href === '/dashboard' ? 'text-brand-600' : 'text-stone-400'}`}>
            <Icon className="size-5" /> {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
