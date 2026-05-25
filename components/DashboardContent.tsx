'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ModuleCard } from '@/components/ModuleCard'
import { RecordList } from '@/components/RecordList'
import type { DashboardSummary } from '@/lib/system-notion'
import { stagger, staggerFast, listItem } from '@/lib/motion'

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

export function DashboardContent({
  initialSummary = null,
  initialError = '',
}: {
  initialSummary?: DashboardSummary | null
  initialError?: string
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(initialSummary ?? EMPTY_SUMMARY)
  const [error, setError] = useState(initialError)
  const [isRefreshing, setIsRefreshing] = useState(!initialSummary && !initialError)

  const fetchSummary = useCallback(() => {
    setError('')
    setIsRefreshing(true)
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else setSummary(data)
      })
      .catch(() => setError('無法載入資料，請檢查網路連線'))
      .finally(() => setIsRefreshing(false))
  }, [])

  useEffect(() => {
    if (initialSummary || initialError) {
      setIsRefreshing(false)
      return
    }
    fetchSummary()
  }, [initialSummary, initialError, fetchSummary])

  const s = summary ?? EMPTY_SUMMARY
  const loading = isRefreshing && !initialSummary

  return (
    <>
      <motion.section
        className="grid gap-5 md:grid-cols-2 xl:grid-cols-5"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <ModuleCard title="CRM 客戶" count={s.customers.activeThisMonth ?? s.customers.total} countLabel={s.customers.activeThisMonth != null ? '本月活躍' : undefined} hasMore={s.customers.activeThisMonth == null && (s.customers.hasMore ?? false)} description="客戶主檔、轄區查閱與後續拜訪紀錄入口。" href="/customers" accent="#0f766e" />
            <ModuleCard title="RMA 工單" count={s.tickets.total} hasMore={s.tickets.hasMore} description="維修案件、技術支援與設備追蹤入口。" href="/tickets" accent="#b45309" />
            <ModuleCard title="BD 商機" count={s.opportunities.total} hasMore={s.opportunities.hasMore} description="活動名單、商機跟進與成交流程入口。" href="/bd" accent="#7c3aed" />
            <ModuleCard title="產品管理" count={s.products.total} hasMore={s.products.hasMore} description="產品清單、系列與報價使用資料入口。" href="/products" accent="#2563eb" />
            <ModuleCard title="帳號權限" count={s.users.total} hasMore={s.users.hasMore} description="使用者帳號、角色與後續 RBAC 權限設定。" href="/settings/accounts" accent="#dc2626" />
          </>
        )}
      </motion.section>

      {loading && !error && (
        <p className="mt-4 text-sm text-slate-500">
          正在同步首頁資料，模組入口已可直接使用。
        </p>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="flex-1 text-sm text-amber-700">{error}</p>
          <button
            onClick={fetchSummary}
            className="shrink-0 text-sm font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2"
          >
            重新整理
          </button>
        </div>
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
            <div className="panel p-6">
              <h3 className="text-base font-semibold text-gray-900">快速操作</h3>
              <motion.div
                className="mt-4 grid gap-3"
                variants={staggerFast}
                initial="hidden"
                animate="show"
              >
                <motion.div variants={listItem}>
                  <Link href="/quote/new" className="button-primary w-full justify-start py-3">
                    建立報價單
                  </Link>
                </motion.div>
                <motion.div variants={listItem}>
                  <Link href="/tickets/new" className="button-secondary w-full justify-start py-3">
                    建立工單
                  </Link>
                </motion.div>
                <motion.div variants={listItem}>
                  <Link href="/tickets" className="button-secondary w-full justify-start py-3">
                    查看維修案件
                  </Link>
                </motion.div>
                <motion.div variants={listItem}>
                  <Link href="/settings/accounts" className="button-secondary w-full justify-start py-3">
                    檢視帳號權限
                  </Link>
                </motion.div>
              </motion.div>
            </div>
          </>
        )}
      </section>
    </>
  )
}
