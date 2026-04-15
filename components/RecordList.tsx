export function RecordList({
  title,
  items,
  emptyLabel,
}: {
  title: string
  items: Array<{ id: string; title: string; meta: string }>
  emptyLabel: string
}) {
  return (
    <section className="panel p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Overview</p>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          {items.length} 筆
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-sm text-slate-400">
            {emptyLabel}
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#fbfcfb_0%,#f6f8f6_100%)] px-4 py-4 transition hover:border-emerald-200 hover:bg-white"
            >
              <div className="font-semibold text-slate-900">{item.title}</div>
              <div className="mt-1 text-sm text-slate-500">
                {item.meta || '尚未補充資訊'}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
