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
                className="absolute inset-0 block h-full w-full rounded-2xl bg-gradient-to-br from-brand-100/80 to-gold-100/60"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.2 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.1 } }}
              />
            )}
          </AnimatePresence>
          <div className="relative z-10 rounded-2xl border border-brand-200/50 bg-white/80 p-4 shadow-sm backdrop-blur-sm transition-shadow duration-200 group-hover:shadow-md group-hover:border-brand-300/60">
            <p className="eyebrow mb-2">{item.badge}</p>
            <p className="text-sm font-semibold text-stone-800">{item.title}</p>
            <p className="mt-1 text-xs text-stone-500">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
