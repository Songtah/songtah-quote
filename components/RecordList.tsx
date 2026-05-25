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
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
          {items.length} 筆
        </div>
      </div>
      {items.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-2 divide-y divide-gray-100">
          {items.map((item) => (
            <div key={item.id} className="py-3">
              <div className="text-sm font-medium text-gray-900">{item.title}</div>
              <div className="mt-0.5 text-sm text-gray-500">
                {item.meta || '尚未補充資訊'}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
