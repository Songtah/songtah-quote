import postgres from 'postgres'

// Supabase Postgres。連線字串放環境變數 DATABASE_URL（Transaction pooler，port 6543）。
// 只在伺服器端使用；瀏覽器絕不直連。
let _sql: ReturnType<typeof postgres> | null = null

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL
}

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL 未設定')
    _sql = postgres(url, {
      prepare: false,          // transaction pooler 不支援 prepared statements
      max: 5,
      // Vercel 函式閒置時會被凍結：連線若在凍結期間被資料庫端斷掉，解凍後第一次查詢會卡住不回
      // （2026-11-14 實測總經理儀表板隨機一段查詢卡滿 25 秒）。閒置 5 秒就關、每條最多用 5 分鐘。
      idle_timeout: 5,
      max_lifetime: 300,
      // 不在同一條連線上連發多個查詢：搭配 Supabase transaction pooler 時偶爾會有查詢永遠不回
      // （正式站並行 12 個查詢時隨機一個卡住，本機重現不到）。
      max_pipeline: 1,
      connect_timeout: 10,
      ssl: 'require',
    } as postgres.Options<{}>)   // max_pipeline 是套件支援的設定，但型別定義沒列出
  }
  return _sql
}
