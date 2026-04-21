'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ModuleCard } from '@/components/ModuleCard'
import { RecordList } from '@/components/RecordList'
import type { DashboardSummary } from '@/lib/system-notion'

const EMPTY_SUMMARY: DashboardSummary = {
  customers: { total: 0, recent: [] },
  tickets: { total: 0, recent: [] },
  opportunities: { total: 0, recent: [] },
  products: { total: 0, recent: [] },
  users: { total: 0, recent: [] },
}

function SkeletonCard() {
  return (
    <div className="panel relative overflow-hidden p-6 animate-pulse">
      <div className="h-3 w-16 rounded bg-slate-200 mb-4" />
      <div className="h-2 w-24 rounded-full bg-slate-200 mb-4" />
      <div className="flex items-end justify-between gap-3">
        <div className="h-5 w-24 rounded bg-slate-200" />
        <div className="h-8 w-10 rounded bg-slate-200" />
      </div>
      <div className="h-3 w-full rounded bg-slate-100 mt-3" />
      <div className="h-3 w-2/3 rounded bg-slate-100 mt-2" />
    </div>
  )
}

function SkeletonList() {
  return (
    <section className="panel p-6 animate-pulse">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="h-3 w-14 rounded bg-slate-200 mb-2" />
          <div className="h-5 w-24 rounded bg-slate-200" />
        </div>
        <div className="h-5 w-10 rounded-full bg-slate-200" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-slate-200 px-4 py-4">
            <div className="h-4 w-48 rounded bg-slate-200 mb-2" />
            <div className="h-3 w-32 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </section>
  )
}

export function DashboardContent() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else setSummary(data)
      })
      .catch(() => setError('無法載入資料'))
  }, [])

  const s = summary ?? EMPTY_SUMMARY
  const loading = summary === null && !error

  return (
    <>
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <ModuleCard title="CRM 客戶" count={s.customers.activeThisMonth ?? s.customers.total} countLabel={s.customers.activeThisMonth != null ? '本月活躍' : undefined} description="客戶主檔、轄區查閱與後續拜訪紀錄入口。" href="/customers" accent="#0f766e" />
            <ModuleCard title="RMA 工單" count={s.tickets.total} description="維修案件、技術支援與設備追蹤入口。" href="/tickets" accent="#b45309" />
            <ModuleCard title="BD 商機" count={s.opportunities.total} description="活動名單、商機跟進與成交流程入口。" href="/bd" accent="#7c3aed" />
            <ModuleCard title="產品管理" count={s.products.total} description="產品清單、系列與報價使用資料入口。" href="/products" accent="#2563eb" />
            <ModuleCard title="帳號權限" count={s.users.total} description="使用者帳號、角色與後續 RBAC 權限設定。" href="/settings/accounts" accent="#dc2626" />
          </>
        )}
      </section>

      {error && (
        <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          {error}
        </p>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        {loading ? (
          <>
            <SkeletonList />
            <SkeletonList />
          </>
        ) : (
          <>
            <RecordList title="近期工單" items={s.tickets.recent} emptyLabel="目前尚未讀到案件資料。" />
            <RecordList title="近期商機" items={s.opportunities.recent} emptyLabel="目前尚未讀到商機資料。" />
          </>
        )}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        {loading ? (
          <>
            <SkeletonList />
            <div className="panel p-6 animate-pulse h-48" />
          </>
        ) : (
          <>
            <RecordList title="重點客戶" items={s.customers.recent} emptyLabel="目前尚未讀到客戶資料。" />
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)]">
              <h3 className="text-lg font-bold text-slate-900">快速操作</h3>
              <div className="mt-4 grid gap-3">
                <Link href="/quote/new" className="rounded-2xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-900">
                  建立報價單
                </Link>
                <Link href="/tickets/new" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                  建立工單
                </Link>
                <Link href="/tickets" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                  查看維修案件
                </Link>
                <Link href="/settings/accounts" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                  檢視帳號權限
                </Link>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  )
}
