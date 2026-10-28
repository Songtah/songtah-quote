'use client'

/**
 * 載入中骨架：用「真的」導覽列（側邊欄／手機頂端列／底部列）＋與實際頁面相同的外距與寬度，
 * 只有內容區是灰塊。2026-10-28：原本各頁骨架自己畫一套（沒有手機頂端列、寬度與邊距不同），
 * 手機上一開啟先看到尺寸不一樣的預覽，資料到了整頁往下跳。
 */
import { AppSidebar, AppMobileNav, AppBottomNav } from '@/components/AppNav'

const block = 'animate-pulse rounded-2xl bg-stone-100 motion-reduce:animate-none'

/** 內容區灰塊：標題＋幾列 */
function Body({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <div className="mb-6 space-y-2 sm:mb-8">
        <div className={`${block} h-3 w-20 rounded-full`} />
        <div className={`${block} h-8 w-48 rounded-full`} />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => <div key={i} className={`${block} h-20`} />)}
      </div>
    </div>
  )
}

/** 一般頁面（components/AppShell 的版面） */
export function ShellSkeleton({ rows }: { rows?: number }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-stone-800">
      <AppSidebar />
      <AppMobileNav />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 sm:px-7 sm:pt-8 lg:ml-60 lg:px-10 lg:pb-10" aria-busy="true">
        <p className="sr-only">載入中</p>
        <Body rows={rows} />
      </main>
      <AppBottomNav />
    </div>
  )
}

/** 首頁（components/SalesTodayDashboard 的版面） */
export function DashboardSkeleton() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-stone-800">
      <AppSidebar />
      <AppMobileNav />
      <main className="pb-24 lg:ml-60 lg:pb-10" aria-busy="true">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-7 sm:py-9 lg:px-10" aria-hidden="true">
          <p className="sr-only">載入中</p>
          <div className="mb-7 space-y-2">
            <div className={`${block} h-4 w-32 rounded-full`} />
            <div className={`${block} h-8 w-48 rounded-full`} />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,.75fr)]">
            <div className={`${block} h-[300px] rounded-3xl`} />
            <div className={`${block} h-[300px] rounded-3xl`} />
          </div>
          <div className="mt-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className={`${block} h-20`} />)}
          </div>
        </div>
      </main>
      <AppBottomNav />
    </div>
  )
}
