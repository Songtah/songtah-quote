'use client'

/**
 * 報名名單「客戶配對」欄：顯示配對到的客戶名稱（連到客戶主檔），並可即時改配或取消配對。
 * 人工調整後配對說明以「人工」開頭，自動配對排程不會再改動。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Hit = { id: string; name: string; city: string; district: string; type: string }

export type CustomerMatch = { customerId: string; customerName: string; customerArea: string; matchNote: string }

export function RegistrationCustomerCell({
  registrationId, institution, value, onChange,
}: {
  registrationId: string
  institution: string
  value: CustomerMatch
  onChange: (v: CustomerMatch) => void
}) {
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)

  // 預設用報名填的單位名稱去掉常見後綴後搜尋，多數情況打開就看得到候選
  function open() {
    const stem = institution.replace(/[（(].*?[)）]/g, '').replace(/(牙醫診所|牙體技術所|牙技所|技工所|診所|牙醫|牙科|醫院)$/, '').trim()
    setQ(stem === '（未填單位）' ? '' : stem || institution)
    setError('')
    setEditing(true)
  }

  useEffect(() => {
    if (!editing) return
    const keyword = q.trim()
    if (keyword.length < 1) { setHits([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(keyword)}`)
        const json = await res.json()
        setHits(Array.isArray(json) ? json.slice(0, 12) : [])
      } catch {
        setHits([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q, editing])

  // 點外面關閉
  useEffect(() => {
    if (!editing) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setEditing(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [editing])

  async function save(customerId: string | null) {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/events/${registrationId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _type: 'registration-customer', customerId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '更新失敗')
      onChange({ customerId: json.customerId, customerName: json.customerName, customerArea: json.customerArea, matchNote: json.matchNote })
      setEditing(false)
    } catch (e: any) {
      setError(e?.message ?? '更新失敗')
    } finally {
      setSaving(false)
    }
  }

  const manual = value.matchNote.startsWith('人工')
  return (
    <div ref={box} className="min-w-[11rem]">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {value.customerId ? (
            <Link href={`/customers/${value.customerId}`} className="font-medium text-brand-700 hover:underline">
              {value.customerName || '查看客戶'}
            </Link>
          ) : (
            <span className="text-xs text-stone-400">未配對</span>
          )}
          {value.customerArea && <p className="text-[11px] text-stone-400">{value.customerArea}</p>}
          {value.matchNote && (
            <p className={`mt-0.5 max-w-[16rem] text-[11px] leading-4 ${manual ? 'text-brand-600' : 'text-stone-400'}`}>{value.matchNote}</p>
          )}
        </div>
        <button onClick={() => (editing ? setEditing(false) : open())}
          className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">
          編輯
        </button>
      </div>

      {editing && (
        // 表格在 overflow-x-auto 容器內，浮動視窗會被裁掉，改為在儲存格內展開
        <div className="mt-2 w-72 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-stone-900/10">
          <p className="text-[11px] text-stone-500">報名填寫：{institution}</p>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋客戶名稱"
            className="input-soft mt-2 w-full text-sm" />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {searching && <p className="px-2 py-2 text-xs text-stone-400">搜尋中…</p>}
            {!searching && q.trim() && hits.length === 0 && <p className="px-2 py-2 text-xs text-stone-400">查無客戶</p>}
            {hits.map((h) => (
              <button key={h.id} onClick={() => save(h.id)} disabled={saving}
                className={`block w-full rounded-xl px-2 py-1.5 text-left text-sm transition-all hover:bg-brand-50 active:scale-[0.98] disabled:opacity-40 ${h.id === value.customerId ? 'bg-brand-50' : ''}`}>
                <span className="font-medium text-stone-800">{h.name}</span>
                <span className="block text-[11px] text-stone-400">{[h.city + h.district, h.type].filter(Boolean).join('・')}</span>
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex justify-between border-t border-stone-900/[0.06] pt-2">
            {value.customerId ? (
              <button onClick={() => save(null)} disabled={saving} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-40">取消配對</button>
            ) : <span />}
            <button onClick={() => setEditing(false)} className="text-xs text-stone-500 hover:underline">關閉</button>
          </div>
        </div>
      )}
    </div>
  )
}
