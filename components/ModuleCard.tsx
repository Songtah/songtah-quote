import Link from 'next/link'

export function ModuleCard({
  title,
  count,
  countLabel,
  description,
  href,
  accent,
  hasMore = false,
}: {
  title: string
  count: number
  countLabel?: string
  description: string
  href: string
  accent: string
  hasMore?: boolean
}) {
  return (
    <Link
      href={href}
      className="group panel p-6 transition hover:border-gray-300 hover:shadow-sm"
    >
      <div className="eyebrow mb-3">Module</div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          {countLabel && (
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {countLabel}
            </p>
          )}
        </div>
        <div className="shrink-0 text-3xl font-black text-gray-900">{count}{hasMore ? '+' : ''}</div>
      </div>
      <p className="muted mt-3">{description}</p>
      <div className="mt-4 text-sm font-medium text-gray-500 transition group-hover:text-gray-900">
        進入模組 →
      </div>
    </Link>
  )
}
