'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

type FontSize = 'normal' | 'large' | 'xlarge'

const OPTIONS: { value: FontSize; label: string; title: string }[] = [
  { value: 'normal', label: '標', title: '標準字體' },
  { value: 'large',  label: '大', title: '大字體'   },
  { value: 'xlarge', label: '特', title: '超大字體' },
]

function applyFontSize(size: FontSize) {
  localStorage.setItem('songtah-fs', size)
  if (size === 'normal') {
    document.documentElement.removeAttribute('data-fs')
  } else {
    document.documentElement.setAttribute('data-fs', size)
  }
}

/** 嵌入 AppShell header 的橫排小按鈕 */
export function FontSizeToggle() {
  const [current, setCurrent] = useState<FontSize>('normal')

  useEffect(() => {
    const saved = localStorage.getItem('songtah-fs') as FontSize | null
    if (saved && saved !== 'normal') setCurrent(saved)
  }, [])

  const apply = (size: FontSize) => { setCurrent(size); applyFontSize(size) }

  return (
    /* 用 px 固定尺寸，避免自己被 xlarge 字型影響而撐大 header */
    <div className="flex items-center gap-[4px] rounded-full bg-stone-100 px-[4px] py-[2px] ring-1 ring-stone-900/[0.05]">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => apply(opt.value)}
          title={opt.title}
          style={{
            fontSize: opt.value === 'normal' ? '13px' : opt.value === 'large' ? '15px' : '18px',
          }}
          className={[
            'rounded-full px-[8px] py-[2px] font-semibold transition-all leading-none select-none',
            current === opt.value
              ? 'bg-white shadow-sm text-stone-800 ring-1 ring-stone-900/[0.06]'
              : 'text-stone-400 hover:text-stone-600',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 固定浮動在頁面右下角，所有頁面皆可使用 */
export function FloatingFontSizeToggle() {
  const pathname = usePathname()
  const [current, setCurrent] = useState<FontSize>('normal')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('songtah-fs') as FontSize | null
    if (saved) setCurrent(saved)
  }, [])

  const apply = (size: FontSize) => { setCurrent(size); applyFontSize(size) }

  // 內部頁面的 AppShell 已內建字級控制；只在獨立頁面保留浮動入口。
  if (pathname !== '/dashboard' && pathname !== '/login' && !pathname.startsWith('/share/')) return null

  return (
    <div className="fixed bottom-20 right-4 z-[9999] flex flex-col items-end gap-2 lg:bottom-5 lg:right-5">
      {/* 展開的選項面板 */}
      {visible && (
        <div className="mb-1 flex flex-col gap-2 rounded-3xl bg-white p-3 shadow-xl ring-1 ring-stone-900/[0.06]">
          <p className="mb-1 text-center text-xs font-medium text-stone-400">字體大小</p>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { apply(opt.value); setVisible(false) }}
              className={[
                'flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all w-28',
                current === opt.value
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-stone-50 text-stone-700 hover:bg-stone-100',
              ].join(' ')}
            >
              <span className={
                opt.value === 'normal' ? 'text-base font-bold w-5 text-center' :
                opt.value === 'large'  ? 'text-lg font-bold w-5 text-center'   :
                                         'text-xl font-bold w-5 text-center'
              }>A</span>
              <span className="text-sm font-medium">{opt.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* 浮動觸發按鈕 */}
      <button
        onClick={() => setVisible((v) => !v)}
        title="調整字體大小"
        className={[
          'w-11 h-11 rounded-full shadow-lg border flex items-center justify-center',
          'text-base font-bold transition-all select-none',
          visible
            ? 'bg-brand-500 border-brand-500 text-white'
            : 'bg-white border-stone-200 text-stone-600 hover:border-brand-400 hover:text-brand-600',
        ].join(' ')}
      >
        A
      </button>
    </div>
  )
}
