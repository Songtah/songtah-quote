'use client'

import { useState } from 'react'
import { PromotionsContent } from '@/components/PromotionsContent'
import { EventsContent } from '@/components/EventsContent'
import { CourseCostsContent } from '@/components/CourseCostsContent'

type Tab = '促銷活動' | '活動管理' | '活動規劃'

const TABS: Tab[] = ['促銷活動', '活動管理', '活動規劃']

const TAB_DESC: Record<Tab, string> = {
  '促銷活動': '管理季度展場、月度促銷與課程等活動，供業務開訂單時參考。',
  '活動管理': '管理崧達舉辦的各類活動，追蹤報名情況。',
  '活動規劃': '試算每場課程的成本、收入與利潤，輔助辦課決策。',
}

export function MarketingContent({
  isPromotionsAdmin = false,
}: {
  isPromotionsAdmin?: boolean
}) {
  const [activeTab, setActiveTab] = useState<Tab>('促銷活動')

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-2xl bg-stone-100/80 p-1 sm:inline-flex sm:w-auto sm:rounded-full">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`min-h-11 whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold transition-all active:scale-95 ${
              activeTab === tab
                ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-900/[0.04]'
                : 'text-stone-500 hover:bg-white/60 hover:text-stone-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="-mt-2 max-w-2xl text-sm leading-6 text-stone-500">{TAB_DESC[activeTab]}</p>

      {/* Content */}
      <div key={activeTab}>
        {activeTab === '促銷活動' && <PromotionsContent isAdmin={isPromotionsAdmin} />}
        {activeTab === '活動管理' && <EventsContent />}
        {activeTab === '活動規劃' && <CourseCostsContent />}
      </div>
    </div>
  )
}
