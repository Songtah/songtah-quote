/**
 * lib/event-type-rules.ts — 各活動類型用到哪些功能（活動頁分頁與結案報告區塊共用；2026-11-14 使用者定調）。
 *   展覽：不用報名、不做滿意度調查，只做活動問卷
 *   產品發表：不做活動問卷
 *   培訓（課程）、研討會、其他：全部
 * 已經有資料的一律照常顯示（hasData 由呼叫端帶入），不會因為類型把既有資料藏起來。
 */
export type EventSections = { registration: boolean; survey: boolean; satisfaction: boolean }

export function eventSectionsByType(type: string): EventSections {
  if (type === '展覽') return { registration: false, survey: true, satisfaction: false }
  if (type === '產品發表') return { registration: true, survey: false, satisfaction: true }
  return { registration: true, survey: true, satisfaction: true }
}

export function eventSections(type: string, hasData: Partial<EventSections>): EventSections {
  const base = eventSectionsByType(type)
  return {
    registration: base.registration || !!hasData.registration,
    survey: base.survey || !!hasData.survey,
    satisfaction: base.satisfaction || !!hasData.satisfaction,
  }
}
