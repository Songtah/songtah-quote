import Link from 'next/link'

export function ModuleCard({
  title,
  count,
  countLabel,
  description,
  href,
  accent,
}: {
  title: string
  count: number
  countLabel?: string
  description: string
  href: string
  accent: string
}) {
  return (
    <Link
      href={href}
      className="group panel relative overflow-hidden p-6 transition hover:-translate-y-1 hover:shadow-[0_28px_70px_-38px_rgba(16,185,129,0.45)]"
    >
      <div
        className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full opacity-10 blur-2xl"
        style={{ backgroundColor: accent }}
      />
      <div className="eyebrow mb-4">Module</div>
      <div className="mb-4 h-2 w-24 rounded-full" style={{ backgroundColor: accent }} />
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-xl font-bold text-slate-900">{title}</h3>
        <div className="text-right">
          <div className="text-3xl font-black text-slate-900">{count}</div>
          {countLabel && (
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-0.5">
              {countLabel}
            </div>
          )}
        </div>
      </div>
      <p className="muted mt-3">{description}</p>
      <div className="mt-5 text-sm font-semibold text-emerald-700 transition group-hover:text-emerald-800">
        進入模組
      </div>
    </Link>
  )
}
