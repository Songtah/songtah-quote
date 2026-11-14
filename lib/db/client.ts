import postgres from 'postgres'

// Supabase Postgres。連線字串放環境變數 DATABASE_URL；程式自動改走 session pooler（port 5432，見下方說明）。
// 只在伺服器端使用；瀏覽器絕不直連。
let _sql: ReturnType<typeof postgres> | null = null

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL
}

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL 未設定')
    // 一律走 Supabase session pooler（5432），不用 transaction pooler（6543）：
    // 2026-11-14 實測 postgres.js 搭 transaction pooler，只要同時查詢數超過連線池上限（要排隊），
    // 排隊的查詢就永遠不回（max=3、並行 4 → 2 筆卡死；max=10、並行 30 → 38 筆卡死）；
    // session pooler 同樣條件全部正常。正式站隨機卡 25～300 秒的總經理儀表板、客戶頁設備清單都是這個原因。
    const sessionUrl = url.replace(/(pooler\.supabase\.com):6543\//, '$1:5432/')
    _sql = postgres(sessionUrl, {
      prepare: false,
      max: 3,                  // session pooler 的伺服器連線是共用的，每個函式實例少開幾條
      // Vercel 函式閒置時會被凍結：連線若在凍結期間被資料庫端斷掉，解凍後第一次查詢會卡住不回
      // （2026-11-14 實測總經理儀表板隨機一段查詢卡滿 25 秒）。閒置 5 秒就關、每條最多用 5 分鐘。
      idle_timeout: 5,
      max_lifetime: 300,
      connect_timeout: 10,
      ssl: 'require',
    })
  }
  return _sql
}
