export default function TicketsLoading() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(21,128,61,0.08),transparent_28%),linear-gradient(180deg,#f8f4ea_0%,#eff4ef_54%,#e6eee8_100%)]">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 rounded-[32px] border border-white/80 bg-white/72 p-8">
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200 mb-3" />
          <div className="h-8 w-48 animate-pulse rounded bg-slate-200 mb-2" />
          <div className="h-4 w-80 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-[28px] border border-slate-200 bg-white p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 animate-pulse h-64" />
      </div>
    </div>
  )
}
