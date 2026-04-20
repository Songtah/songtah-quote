'use client'

import { cn } from '@/lib/utils'
import React, { useEffect, useRef } from 'react'

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
            <stop offset="0%" stopColor="rgba(22,101,52,0.15)" />
            <stop offset="50%" stopColor="rgba(22,101,52,0.06)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <filter id="beam-blur">
            <feGaussianBlur in="SourceGraphic" stdDeviation="40" />
          </filter>
        </defs>
        {/* Animated beams */}
        {[...Array(6)].map((_, i) => (
          <line
            key={i}
            x1={`${10 + i * 16}%`}
            y1="-10%"
            x2={`${20 + i * 12}%`}
            y2="110%"
            stroke="url(#beam-gradient)"
            strokeWidth={1 + Math.random() * 2}
            className="animate-beam"
            style={{
              animationDelay: `${i * 1.2}s`,
              animationDuration: `${8 + i * 1.5}s`,
            }}
          />
        ))}
        <rect width="100%" height="100%" fill="url(#beam-gradient)" filter="url(#beam-blur)" opacity="0.4" />
      </svg>
    </div>
  )
}
