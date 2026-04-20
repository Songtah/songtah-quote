'use client'

import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'

export function HoverEffect({
  items,
  className,
}: {
  items: { title: string; description: string; badge: string }[]
  className?: string
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', className)}>
      {items.map((item, idx) => (
        <div
          key={idx}
          className="group relative block h-full w-full cursor-default"
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <AnimatePresence>
            {hoveredIndex === idx && (
              <motion.span
                className="absolute inset-0 block h-full w-full rounded-2xl bg-emerald-100/60"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.2 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.1 } }}
              />
            )}
          </AnimatePresence>
          <div className="relative z-10 rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm backdrop-blur transition-shadow duration-200 group-hover:shadow-lg">
            <p className="eyebrow mb-2">{item.badge}</p>
            <p className="text-sm font-semibold text-slate-900">{item.title}</p>
            <p className="mt-1 text-xs text-slate-500">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
