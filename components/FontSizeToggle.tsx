'use client'

import { useEffect, useState } from 'react'

type FontSize = 'normal' | 'large' | 'xlarge'

const OPTIONS: { value: FontSize; label: string; title: string }[] = [
  { value: 'normal', label: '標', title: '標準字體' },
  { value: 'large',  label: '大', title: '大字體'   },
  { value: 'xlarge', label: '特', title: '超大字體' },
]

function applyFontSize(size: FontSize) {
  if (size === 'normal') {
    document.documentElement.removeAttribute('data-fs')
  } else {
    document.documentElement.setAttribute('data-fs', size)
  }
  try { localStorage.setItem('songtah-fs', size) } catch {}
}

function isFontSize(value: string | null): value is FontSize {
  return value === 'normal' || value === 'large' || value === 'xlarge'
}

function useStoredFontSize() {
  const [current, setCurrent] = useState<FontSize>('normal')

  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('songtah-fs') } catch {}
    if (isFontSize(saved)) {
      setCurrent(saved)
      applyFontSize(saved)
    }

    const sync = (event: StorageEvent) => {
      if (event.key === 'songtah-fs' && isFontSize(event.newValue)) {
        setCurrent(event.newValue)
        applyFontSize(event.newValue)
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const apply = (size: FontSize) => {
    setCurrent(size)
    applyFontSize(size)
  }
  return { current, apply }
}

/** 嵌入 AppShell header 的橫排小按鈕 */
export function FontSizeToggle() {
  const { current, apply } = useStoredFontSize()

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
  const { current, apply } = useStoredFontSize()
  const [visible, setVisible] = useState(false)

  return (
    <div className="fixed bottom-20 right-4 z-[9999] flex flex-col items-end gap-2 print:hidden lg:bottom-5 lg:right-5">
      {/* 展開的選項面板 */}
      {visible && (
        <div className="mb-1 flex flex-col gap-2 rounded-3xl bg-white p-3 shadow-xl ring-1 ring-stone-900/[0.06]">
          <p className="mb-1 text-center text-xs font-medium text-stone-400">全站字體大小</p>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { apply(opt.value); setVisible(false) }}
              className={[
                'flex min-h-12 w-32 items-center gap-3 rounded-2xl px-4 py-2.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50',
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
        type="button"
        onClick={() => setVisible((v) => !v)}
        title="調整字體大小"
        aria-label="調整全站字體大小"
        aria-expanded={visible}
        className={[
          'flex size-12 items-center justify-center rounded-full border shadow-lg',
          'text-base font-bold transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50',
          visible
            ? 'bg-brand-500 border-brand-500 text-white'
            : 'bg-white border-stone-200 text-stone-600 hover:border-brand-400 hover:text-brand-600',
        ].join(' ')}
      >
        A<span className="ml-0.5 text-[10px]">{current === 'normal' ? '標' : current === 'large' ? '大' : '特'}</span>
      </button>
    </div>
  )
}
