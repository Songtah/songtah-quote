'use client'

import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'

interface SpotlightProps {
  className?: string
  fill?: string
}

export function Spotlight({ className, fill = 'rgba(184,149,106,0.12)' }: SpotlightProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      setPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
    const el = ref.current?.parentElement
    el?.addEventListener('mousemove', handleMouse)
    return () => el?.removeEventListener('mousemove', handleMouse)
  }, [])

  return (
    <div ref={ref} className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        className="absolute h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50 blur-[140px] transition-all duration-700 ease-out"
        style={{
          left: position.x || '50%',
          top: position.y || '30%',
          background: `radial-gradient(circle, ${fill} 0%, transparent 70%)`,
        }}
      />
    </div>
  )
}
