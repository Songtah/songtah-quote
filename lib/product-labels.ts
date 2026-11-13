/**
 * 產品頁對使用者顯示的狀態用語（單一來源）。
 * 資料欄位名稱不變：Notion 產品庫的 checkbox 仍叫「中央停用」、程式欄位仍是 disabled／priceSource。
 */
export const PRODUCT_LABELS = {
  /** 中央管理手動隱藏、可恢復（原「中央停用」） */
  paused: '暫停販售',
  resume: '恢復販售',
  onSale: '販售中',
  /** 主檔正式停售／未販售（ERP 核對表） */
  discontinued: '停售',
  /** 中央管理在後台填的售價，蓋過目錄基準價（原「後台調價／後台價」） */
  manualPrice: '手動調價',
  unpriced: '待定價',
  /** 分類還沒人工確認（原「分類待覆核」） */
  needsReview: '分類待確認',
} as const
