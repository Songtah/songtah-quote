'use client'

import { cn } from '@/lib/utils'
import React, { useRef } from 'react'

export function BackgroundBeams({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null)

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="beam-gradient" cx="50%" cy="0%" r="60%">
            <stop offset="0%" stopColor="rgba(184,149,106,0.12)" />
            <stop offset="50%" stopColor="rgba(184,149,106,0.04)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="gold-beam" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(212,154,42,0.08)" />
            <stop offset="50%" stopColor="rgba(184,149,106,0.12)" />
            <stop offset="100%" stopColor="rgba(212,154,42,0.04)" />
          </linearGradient>
          <filter id="beam-blur">
            <feGaussianBlur in="SourceGraphic" stdDeviation="40" />
          </filter>
        </defs>
        {/* Subtle gold beams */}
        {[...Array(5)].map((_, i) => (
          <line
            key={i}
            x1={`${12 + i * 18}%`}
            y1="-10%"
            x2={`${22 + i * 14}%`}
            y2="110%"
            stroke="url(#gold-beam)"
            strokeWidth={0.8 + i * 0.3}
            className="animate-beam"
            style={{
              animationDelay: `${i * 1.8}s`,
              animationDuration: `${10 + i * 2}s`,
            }}
          />
        ))}
        <rect width="100%" height="100%" fill="url(#beam-gradient)" filter="url(#beam-blur)" opacity="0.3" />
      </svg>
    </div>
  )
}
