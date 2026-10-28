'use client'

/**
 * 通知鈴鐺：站內通知中心＋這台裝置的推播開關（lib/notifications.ts）。
 * 每 60 秒、切回分頁時更新；點通知會標為已讀並前往對應頁面。
 * iPhone：Safari 分頁收不到推播，要先「加到主畫面」再從主畫面開啟（iOS 16.4 以上），這裡會提示步驟。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellOff, BellRing, Share, X } from 'lucide-react'

type Item = { id: string; title: string; body: string; href: string; createdAt: number; read: boolean }
type PushState = 'loading' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'denied' | 'unavailable'

function ago(t: number) {
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小時前`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d} 天前` : new Date(t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

function keyToBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = () => typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true)

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [pushKey, setPushKey] = useState('')
  const [push, setPush] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setItems(json.items ?? [])
      setUnread(json.unread ?? 0)
      setPushKey(json.pushKey ?? '')
    } catch { /* 網路斷線時下次再試 */ }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  // 這台裝置的推播狀態
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setPush(isIOS() && !isStandalone() ? 'ios-install' : 'unsupported'); return
      }
      if (Notification.permission === 'denied') { setPush('denied'); return }
      const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined)
      const sub = await reg?.pushManager.getSubscription().catch(() => null)
      setPush(sub ? 'on' : 'off')
    })()
  }, [])

  // 點外面或按 Esc 關閉
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function markRead(ids: string[]) {
    if (!ids.length) return
    setItems((list) => list.map((x) => (ids.includes(x.id) ? { ...x, read: true } : x)))
    setUnread((n) => Math.max(0, n - ids.length))
    await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => {})
  }

  async function openItem(item: Item) {
    setOpen(false)
    if (!item.read) markRead([item.id])
    router.push(item.href)
  }

  async function enablePush() {
    setBusy(true); setMsg('')
    try {
      if (!pushKey) { setPush('unavailable'); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPush(permission === 'denied' ? 'denied' : 'off'); return }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(pushKey) })
      const res = await fetch('/api/notifications/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '開啟失敗')
      setPush('on'); setMsg('已開啟，之後有新通知會跳出提醒')
    } catch (e: any) {
      setMsg(e?.message ?? '開啟失敗，請稍後再試')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '傳送失敗')
      setMsg('已送出，幾秒內這台裝置應該會跳出「測試通知」')
      setTimeout(load, 2000)
    } catch (e: any) {
      setMsg(e?.message ?? '傳送失敗')
    } finally {
      setBusy(false)
    }
  }

  async function disablePush() {
    setBusy(true); setMsg('')
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/notifications/push', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setPush('off')
    } finally {
      setBusy(false)
    }
  }

  const pushRow = (() => {
    switch (push) {
      case 'on': return (
        <div className="flex items-center justify-between gap-2 text-xs text-stone-600">
          <span className="flex items-center gap-1.5"><BellRing aria-hidden="true" className="size-3.5 text-pine-600" />這台裝置已開啟通知</span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={sendTest} disabled={busy} className="tap-target rounded-full px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40">傳送測試</button>
            <button type="button" onClick={disablePush} disabled={busy} className="tap-target rounded-full px-3 py-1.5 font-semibold text-stone-500 hover:bg-stone-100 disabled:opacity-40">關閉</button>
          </span>
        </div>)
      case 'off': return pushKey ? (
        <button type="button" onClick={enablePush} disabled={busy}
          className="tap-target flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
          <BellRing aria-hidden="true" className="size-4" />{busy ? '開啟中…' : '開啟這台裝置的通知'}
        </button>) : null
      case 'denied': return <p className="text-xs leading-5 text-stone-500">這個瀏覽器已封鎖本系統的通知。請到瀏覽器的網站設定，把「通知」改為允許後重新整理。</p>
      case 'ios-install': return (
        <p className="text-xs leading-5 text-stone-600">
          iPhone 要先加到主畫面才收得到通知：點 Safari 下方的 <Share aria-hidden="true" className="inline size-3.5 align-text-bottom" /> 分享 →「加入主畫面」，之後從主畫面的「崧達系統」開啟，再回到這裡開啟通知。
        </p>)
      case 'unsupported': return <p className="text-xs leading-5 text-stone-500">這個瀏覽器不支援推播通知，請改用 Chrome、Edge 或 Safari。</p>
      case 'unavailable': return <p className="text-xs leading-5 text-stone-500">推播服務尚未設定完成，請通知管理員。</p>
      default: return null
    }
  })()

  return (
    <>
      <button ref={button} type="button" onClick={() => { setOpen((v) => !v); if (!open) load() }}
        aria-label={unread ? `通知，${unread} 則未讀` : '通知'} aria-expanded={open} aria-haspopup="dialog"
        className="relative rounded-full bg-stone-100 p-3 text-stone-600 transition-all hover:bg-stone-200 active:scale-95">
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-5 text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div ref={panel} role="dialog" aria-label="通知"
          className="card-soft fixed inset-x-3 top-[4.5rem] z-50 flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden lg:inset-x-auto lg:left-64 lg:top-6 lg:w-[24rem]">
          <div className="flex items-center justify-between gap-2 border-b border-stone-900/[0.06] px-5 py-4">
            <h2 className="text-base font-bold text-stone-800">通知</h2>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button type="button" onClick={() => markRead(items.filter((x) => !x.read).map((x) => x.id))}
                  className="tap-target rounded-full px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">全部已讀</button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="關閉通知" className="tap-target rounded-full p-2 text-stone-500 hover:bg-stone-100">
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>

          {pushRow && <div className="border-b border-stone-900/[0.06] bg-cream-50 px-5 py-3">{pushRow}{msg && <p role="status" className="mt-2 text-xs text-stone-600">{msg}</p>}</div>}

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <li className="flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-stone-500">
                <BellOff aria-hidden="true" className="size-6 text-stone-400" />目前沒有通知
              </li>
            ) : items.map((item) => (
              <li key={item.id} className="border-b border-stone-900/[0.04] last:border-0">
                <button type="button" onClick={() => openItem(item)}
                  className={`flex w-full gap-3 px-5 py-3.5 text-left transition-colors hover:bg-stone-50 ${item.read ? '' : 'bg-brand-50/40'}`}>
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read ? 'bg-transparent' : 'bg-brand-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${item.read ? 'font-medium text-stone-600' : 'font-bold text-stone-800'}`}>{item.title}</span>
                    {item.body && <span className="mt-0.5 block text-xs leading-5 text-stone-500">{item.body}</span>}
                    <span className="mt-1 block text-xs text-stone-500">{ago(item.createdAt)}{item.read ? '' : '・未讀'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
