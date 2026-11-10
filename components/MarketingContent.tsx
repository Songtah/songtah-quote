'use client'

import { EventsContent } from '@/components/EventsContent'

/**
 * 行銷管理（2026-11-10 改版）：第一階只有「活動管理」。
 * 促銷、報名表單、活動問卷、滿意度調查、預算核銷都在各場活動底下（components/EventDetailContent.tsx 的分頁）。
 * 「活動規劃（辦課成本試算）」依使用者指示移除；既有試算資料仍保留在資料庫。
 */
export function MarketingContent(_props: { isPromotionsAdmin?: boolean }) {
  return <EventsContent />
}
