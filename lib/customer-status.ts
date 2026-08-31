/**
 * 客戶「機構狀態」的有效／無效判定 —— 全系統唯一真實來源。
 *
 * 為什麼要有這支檔:這組狀態原本散在 11 個地方各自寫一次
 * (territory-areas、customers、visit-suggestions、territories route、
 *  candidates route、territory-coverage、my-customer-list、medical-monitor、
 *  兩支 report page、TerritoryContent),彼此已經漂移——
 *   - lib/notion.ts 的報價/訂貨客戶選單只排除「已歇業」,停業與撤銷仍選得到;
 *   - 區域儀表板的「排除已歇業」也只排一個,和轄區/監控的三個對不上,
 *     同一區的「有效客戶數」在兩個頁面會不一樣。
 * 新增任何「只看有效客戶」的功能一律 import 這裡,不要再各自定義。
 *
 * 注意:這是「顯示與統計」的預設口徑,不是查詢封鎖。
 * 客戶系統必須能查到已歇業資料(searchSystemCustomers 不套此過濾;
 * 區域儀表板明確選擇某個機構狀態時,排除也要讓路),否則沒人能維護這些紀錄。
 */
export const INACTIVE_CUSTOMER_STATUSES = ['已歇業', '停業', '撤銷'] as const
export type InactiveCustomerStatus = (typeof INACTIVE_CUSTOMER_STATUSES)[number]

export const INACTIVE_CUSTOMER_STATUS = new Set<string>(INACTIVE_CUSTOMER_STATUSES)

/** 無效名單:已歇業／停業／撤銷。空白與「狀況不明」一律視為有效(未確認≠已結束)。 */
export function isInactiveCustomer(status: string | null | undefined): boolean {
  return INACTIVE_CUSTOMER_STATUS.has((status ?? '').trim())
}

/** UI 用的統一說法,避免各頁自己寫「排除已歇業」造成誤解 */
export const INACTIVE_STATUS_LABEL = INACTIVE_CUSTOMER_STATUSES.join('／')

/** Notion 端等價過濾(用於能在查詢層就縮小結果的路徑) */
export function notionActiveCustomerClauses() {
  return INACTIVE_CUSTOMER_STATUSES.map((status) => ({
    property: '機構狀態', select: { does_not_equal: status },
  }))
}
