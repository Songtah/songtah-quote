export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-white text-stone-800">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-60 lg:border-r lg:border-stone-900/[0.06] lg:bg-[#fdfdfb]" />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-7 lg:ml-60 lg:px-10">
        <div className="mb-8 space-y-3">
          <div className="h-4 w-36 animate-pulse rounded-full bg-stone-100" />
          <div className="h-9 w-56 animate-pulse rounded-full bg-stone-100" />
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,.75fr)]">
          <div className="h-[300px] animate-pulse rounded-3xl bg-[#eef6ef]" />
          <div className="h-[300px] animate-pulse rounded-3xl bg-[#fdfdfb]" />
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-50" />
          ))}
        </div>
      </div>
    </div>
  )
}
