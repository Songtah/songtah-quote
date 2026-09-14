'use client'

/**
 * TerritoryNewOpeningsPanel — 轄區新機構（業務個人頁）
 *
 * 內容＝醫事比對（衛福部 BAS 開業清單 × 客戶庫）找出、落在該業務轄區的新客戶。
 * 純檢視，不要求業務做任何操作（最高原則）：被匯入／認領後下次計算自動消失。
 * 未建檔機構的地址是衛福部公開資料可顯示；已建檔但未認領的客戶依鐵則不顯示地址。
 * 資料每晚重算（/api/cron/refresh-medical-monitor），與市場監控頁共用同一份比對結果。
 */
import { useEffect, useMemo, useState } from 'react'
import { Building2, MapPin, Sparkles } from 'lucide-react'

type Item = {
  key: string
  source: 'notInDb' | 'imported'
  name: string
  kind: string
  city: string
  district: string
  address: string
  institutionCode: string
  isNewThisMonth: boolean
  owner: string
}

const PAGE = 20

export function TerritoryNewOpeningsPanel() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [viewingAll, setViewingAll] = useState(false)
  const [computedAt, setComputedAt] = useState('')
  const [error, setError] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [visible, setVisible] = useState(PAGE)

  useEffect(() => {
    let alive = true
    fetch('/api/bd/territory-new-openings')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '讀取失敗')
        if (!alive) return
        setItems(json.items ?? [])
        setViewingAll(Boolean(json.viewingAll))
        setComputedAt(json.computedAt ?? '')
      })
      .catch((e) => { if (alive) { setError(e?.message ?? '讀取轄區新機構失敗'); setItems([]) } })
    return () => { alive = false }
  }, [])

  const owners = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items ?? []) m.set(i.owner, (m.get(i.owner) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [items])

  const filtered = useMemo(
    () => (items ?? []).filter((i) => !ownerFilter || (ownerFilter === '__none__' ? !i.owner : i.owner === ownerFilter)),
    [items, ownerFilter])

  if (items !== null && items.length === 0 && !error) return null

  const newThisMonth = (items ?? []).filter((i) => i.isNewThisMonth).length
  const computedLabel = computedAt ? new Date(computedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) : ''

  return (
    <div className="card-soft p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">醫事資料庫比對</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">轄區新機構</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            {viewingAll
              ? '衛福部登記開業、但還沒有人負責的機構，依所在轄區標明負責業務。'
              : '你轄區內衛福部登記開業、但還沒有人負責的機構。拜訪回報後系統會自動處理，不需要在這裡操作。'}
          </p>
        </div>
        {items && (
          <div className="flex shrink-0 items-center gap-2">
            {newThisMonth > 0 && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">本月新增 {newThisMonth}</span>
            )}
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{items.length} 家</span>
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      {items === null && <p className="mt-4 text-sm text-stone-400">比對中…</p>}

      {viewingAll && owners.length > 1 && (
        <div className="mt-4">
          <select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setVisible(PAGE) }} className="select-soft text-sm">
            <option value="">全部業務（{items?.length ?? 0}）</option>
            {owners.map(([o, n]) => (
              <option key={o || '__none__'} value={o || '__none__'}>{o || '不在任何轄區'}（{n}）</option>
            ))}
          </select>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {filtered.slice(0, visible).map((i) => (
            <li key={i.key} className="rounded-2xl bg-stone-50 p-3.5 ring-1 ring-stone-900/5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-800">{i.name}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{i.kind}・{i.city}{i.district}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {i.isNewThisMonth && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                      <Sparkles className="h-3 w-3" />本月新增
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${i.source === 'notInDb' ? 'bg-white text-stone-600 ring-1 ring-stone-900/10' : 'bg-brand-50 text-brand-700'}`}>
                    <Building2 className="h-3 w-3" />{i.source === 'notInDb' ? '尚未建檔' : '已建檔待認領'}
                  </span>
                </div>
              </div>
              {i.address && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.address)}`} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex max-w-full items-center gap-1 text-xs text-brand-700 transition-all hover:text-brand-800 active:scale-95">
                  <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{i.address}</span>
                </a>
              )}
              {viewingAll && (
                <p className="mt-2 text-[11px] text-stone-400">轄區：<span className="font-semibold text-stone-600">{i.owner || '不在任何轄區'}</span></p>
              )}
            </li>
          ))}
        </ul>
      )}

      {filtered.length > visible && (
        <button onClick={() => setVisible((v) => v + PAGE)}
          className="mt-3 rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">
          再顯示（還有 {filtered.length - visible} 家）
        </button>
      )}

      {computedLabel && <p className="mt-3 text-[11px] text-stone-400">比對結果更新於 {computedLabel}，每晚自動重算</p>}
    </div>
  )
}
