export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(21,128,61,0.08),transparent_28%),linear-gradient(180deg,#f8f4ea_0%,#eff4ef_54%,#e6eee8_100%)]">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 rounded-[32px] border border-white/80 bg-white/72 p-8">
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200 mb-3" />
          <div className="h-8 w-64 animate-pulse rounded bg-slate-200 mb-2" />
          <div className="h-4 w-96 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-[28px] border border-slate-200 bg-white p-5 h-36 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
