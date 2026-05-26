'use client'

import { useEffect, useState } from 'react'

type FontSize = 'normal' | 'large' | 'xlarge'

const OPTIONS: { value: FontSize; label: string; display: string; title: string }[] = [
  { value: 'normal', label: '標',  display: 'text-sm',   title: '標準字體' },
  { value: 'large',  label: '大',  display: 'text-base', title: '大字體'   },
  { value: 'xlarge', label: '特',  display: 'text-lg',   title: '超大字體' },
]

export function FontSizeToggle() {
  const [current, setCurrent] = useState<FontSize>('normal')

  // 初始化：從 localStorage 讀取
  useEffect(() => {
    const saved = localStorage.getItem('songtah-fs') as FontSize | null
    if (saved && saved !== 'normal') setCurrent(saved)
  }, [])

  const apply = (size: FontSize) => {
    setCurrent(size)
    localStorage.setItem('songtah-fs', size)
    const html = document.documentElement
    if (size === 'normal') {
      html.removeAttribute('data-fs')
    } else {
      html.setAttribute('data-fs', size)
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1 py-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => apply(opt.value)}
          title={opt.title}
          className={[
            'rounded-full px-2 py-0.5 font-semibold transition-all leading-none select-none',
            opt.display,
            current === opt.value
              ? 'bg-white shadow-sm text-gray-900 ring-1 ring-gray-200'
              : 'text-gray-400 hover:text-gray-600',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
