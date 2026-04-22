export default function TicketsLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-100 via-cream-50 to-brand-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header skeleton */}
        <div className="mb-8 rounded-2xl border border-brand-200/40 bg-white/80 p-8 shadow-[0_16px_48px_-16px_rgba(90,66,51,0.12)]">
          <div className="h-3 w-20 animate-pulse rounded-full bg-stone-200 mb-3" />
          <div className="h-8 w-44 animate-pulse rounded-full bg-stone-200 mb-3" />
          <div className="h-1 w-16 animate-pulse rounded-full bg-stone-200 mb-3" />
          <div className="h-3 w-72 animate-pulse rounded-full bg-stone-200" />
        </div>
        {/* Stats skeleton */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-brand-200/40 bg-white p-5 h-24 animate-pulse" />
          ))}
        </div>
        {/* List skeleton */}
        <div className="rounded-2xl border border-brand-200/40 bg-white p-6 animate-pulse h-64" />
      </div>
    </div>
  )
}
