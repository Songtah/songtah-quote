'use client'

import { useState } from 'react'
import { PromotionsContent } from '@/components/PromotionsContent'
import { EventsContent } from '@/components/EventsContent'
import { AssetLibraryContent } from '@/components/AssetLibraryContent'
import { TripPlannerContent } from '@/components/TripPlannerContent'
import { CourseCostsContent } from '@/components/CourseCostsContent'

type Tab = '促銷活動' | '活動管理' | '活動規劃' | '素材庫' | '行程規劃'

const TABS: Tab[] = ['促銷活動', '活動管理', '活動規劃', '素材庫', '行程規劃']

const TAB_DESC: Record<Tab, string> = {
  '促銷活動': '管理季度展場、月度促銷與課程等活動，供業務開訂單時參考。',
  '活動管理': '管理崧達舉辦的各類活動，追蹤報名情況。',
  '活動規劃': '試算每場課程的成本、收入與利潤，輔助辦課決策。',
  '素材庫':   '共用圖片素材，點擊可預覽並下載壓縮版或原圖。',
  '行程規劃': '出國行程時間軸排程工具。',
}

export function MarketingContent({
  isPromotionsAdmin = false,
  assetsSetupNeeded = false,
}: {
  isPromotionsAdmin?: boolean
  assetsSetupNeeded?: boolean
}) {
  const [activeTab, setActiveTab] = useState<Tab>('促銷活動')

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="inline-flex bg-gray-100 rounded-full px-1 py-1 gap-0.5 flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-sm text-gray-500 -mt-2">{TAB_DESC[activeTab]}</p>

      {/* Content */}
      <div key={activeTab}>
        {activeTab === '促銷活動' && <PromotionsContent isAdmin={isPromotionsAdmin} />}
        {activeTab === '活動管理' && <EventsContent />}
        {activeTab === '活動規劃' && <CourseCostsContent />}
        {activeTab === '素材庫'   && <AssetLibraryContent setupNeeded={assetsSetupNeeded} />}
        {activeTab === '行程規劃' && <TripPlannerContent />}
      </div>
    </div>
  )
}
