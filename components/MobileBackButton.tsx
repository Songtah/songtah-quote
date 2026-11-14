'use client'

/**
 * 手機版內頁的「返回」鍵（lg 以下顯示）。主畫面 App 沒有瀏覽器的上一頁，內頁原本只能關掉 App 重開（還要重新登入）。
 * 這個 App 裡有換過頁就回上一頁；直接開在這一頁（例如從通知、分享連結進來）就回到它所屬的選單頁。
 */
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { NAV_ITEMS } from '@/components/AppNav'

const KEY = 'songtah-inapp-nav'
const SPECIAL_PARENT: [RegExp, string][] = [
  [/^\/quote\//, '/quotes'],
  [/^\/events(\/|$)/, '/marketing'],
  [/^\/equipment\//, '/customers'],
  [/^\/support/, '/dashboard'],
]

export function parentOf(pathname: string): string {
  for (const [re, to] of SPECIAL_PARENT) if (re.test(pathname)) return to
  const hit = NAV_ITEMS.map((i) => i.href).filter((h) => h !== '/dashboard' && pathname.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0]
  return hit ?? '/dashboard'
}

export function isNavRoot(pathname: string): boolean {
  return NAV_ITEMS.some((i) => i.href === pathname)
}

/** 記錄這次開 App 後換過幾頁（換頁時呼叫） */
export function useTrackInAppNav() {
  const pathname = usePathname()
  useEffect(() => {
    try { sessionStorage.setItem(KEY, String(Number(sessionStorage.getItem(KEY) || 0) + 1)) } catch {}
  }, [pathname])
}

export function MobileBackButton() {
  const pathname = usePathname()
  const router = useRouter()
  if (isNavRoot(pathname)) return null
  const goBack = () => {
    let n = 0
    try { n = Number(sessionStorage.getItem(KEY) || 0) } catch {}
    if (n > 1 && window.history.length > 1) router.back()
    else router.push(parentOf(pathname))
  }
  return (
    <button type="button" onClick={goBack} aria-label="返回上一頁"
      className="-ml-1 mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-stone-100 px-3.5 text-sm font-semibold text-stone-600 transition-all active:scale-95 lg:hidden">
      <ArrowLeft className="size-4" />返回
    </button>
  )
}
