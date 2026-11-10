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
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
    })
  }
  return _sql
}
