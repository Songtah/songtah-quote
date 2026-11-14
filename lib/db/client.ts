import postgres from 'postgres'

// Supabase Postgres。連線字串放環境變數 DATABASE_URL（Transaction pooler，port 6543）。
// 只在伺服器端使用；瀏覽器絕不直連。
let _sql: ReturnType<typeof postgres> | null = null

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL
}

/**
 * 同時送出的查詢上限＝連線池大小，超過的在這裡排隊（2026-11-14）。
 * 實測 postgres.js 搭 Supabase transaction pooler：只要查詢在套件內部排隊等連線，排隊的那幾筆就永遠不回
 * （max=3、並行 4 → 2 筆卡死；max=10、並行 30 → 38 筆卡死），正式站總經理儀表板、客戶頁設備清單隨機卡 25～300 秒都是這個原因。
 * 改走 session pooler 雖不卡，但伺服器連線太少，負載一高就「max clients reached」。
 * 所以留在 transaction pooler，改由我們自己排隊，讓套件永遠不必排隊。
 */
const POOL_MAX = 5
let active = 0
const waiters: (() => void)[] = []
function acquire(): Promise<void> {
  if (active < POOL_MAX) { active++; return Promise.resolve() }
  return new Promise<void>((resolve) => waiters.push(resolve))   // 輪到時直接接手前一筆的名額
}
function release() {
  const next = waiters.shift()
  if (next) next(); else active--
}
/** postgres.js 的查詢是惰性的（then 時才送出），所以在 then 之前拿名額即可 */
function gate<T>(q: PromiseLike<T>): any {
  const run = () => acquire().then(() => q.then(
    (v) => { release(); return v },
    (e) => { release(); throw e },
  ))
  let started: Promise<T> | null = null
  const p = () => (started ??= run())
  return {
    then: (ok?: any, bad?: any) => p().then(ok, bad),
    catch: (bad?: any) => p().catch(bad),
    finally: (f?: any) => p().finally(f),
  }
}

export function sql(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL 未設定')
    const raw = postgres(url, {
      prepare: false,          // transaction pooler 不支援 prepared statements
      max: POOL_MAX,
      // Vercel 函式閒置時會被凍結：閒置 5 秒就關、每條最多用 5 分鐘，避免解凍後用到失效連線
      idle_timeout: 5,
      max_lifetime: 300,
      connect_timeout: 10,
      ssl: 'require',
    })
    // 標記樣板呼叫（sql`...`）與 unsafe 才是查詢，要排隊；sql(cols)、sql.json() 等是組語法用的輔助，直接放行
    const wrapped: any = (first: any, ...rest: any[]) => {
      const r = (raw as any)(first, ...rest)
      return Array.isArray(first) && 'raw' in first ? gate(r) : r
    }
    wrapped.unsafe = (...a: any[]) => gate((raw as any).unsafe(...a))
    _sql = new Proxy(wrapped, {
      get: (t, k) => (k in t ? t[k] : typeof (raw as any)[k] === 'function' ? (raw as any)[k].bind(raw) : (raw as any)[k]),
    }) as ReturnType<typeof postgres>
  }
  return _sql
}
