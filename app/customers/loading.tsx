// Next.js App Router 自動把這個當作 Suspense fallback，
// 使用者點選「客戶」按鈕時立刻顯示，等 Server Component 拉完 Notion 資料後替換。

export default function CustomersLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 模擬 AppShell header */}
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 sm:px-6 py-2.5 sm:py-3">
          <div className="h-8 w-28 bg-gray-100 rounded animate-pulse" />
          <div className="hidden sm:block h-6 w-px bg-gray-200" />
          <div className="h-5 w-24 bg-gray-100 rounded animate-pulse hidden sm:block" />
        </div>
        <div className="mx-auto max-w-7xl px-3 sm:px-6 pb-2">
          <div className="h-8 w-64 bg-gray-100 rounded-full animate-pulse" />
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-8">
        {/* 頁面標題 */}
        <div className="mb-4 sm:mb-6 space-y-2">
          <div className="h-7 w-28 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-72 bg-gray-100 rounded animate-pulse" />
        </div>

        <div className="space-y-4">
          {/* 搜尋框 */}
          <div className="h-12 bg-white rounded-xl border border-gray-200 animate-pulse" />

          {/* Type pills */}
          <div className="flex gap-2">
            {[4, 3, 4, 3].map((w, i) => (
              <div key={i} className={`h-8 w-${w * 4} bg-gray-100 rounded-full animate-pulse`} />
            ))}
          </div>

          {/* Filter row */}
          <div className="flex gap-2">
            <div className="h-9 w-28 bg-gray-100 rounded-lg animate-pulse" />
            <div className="h-9 w-28 bg-gray-100 rounded-lg animate-pulse" />
          </div>

          {/* 計數 */}
          <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />

          {/* 客戶列表 */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-50">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-9 h-9 rounded-full bg-gray-100 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div
                    className="h-4 bg-gray-100 rounded animate-pulse"
                    style={{ width: `${30 + (i * 7) % 35}%` }}
                  />
                  <div
                    className="h-3 bg-gray-50 rounded animate-pulse"
                    style={{ width: `${20 + (i * 11) % 25}%` }}
                  />
                </div>
                <div className="w-4 h-4 bg-gray-100 rounded animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
