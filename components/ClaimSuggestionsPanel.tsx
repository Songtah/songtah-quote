'use client'

/**
 * ClaimSuggestionsPanel — 待認領建議（客情回報觸發認領的第二／三層）
 *
 * 第一層（轄區內、無人負責）在客情建檔當下就自動認領完了，不會出現在這裡。
 * 這張面板只放需要人判斷的：轄區外、或該業務尚未設定轄區。
 *
 * 兩個按鈕刻意不對稱——「只是支援」在左且為預設樣式，「認領」需要主動選擇。
 * 實測 80% 的轄區外回報只發生過一次（＝支援/路過），把認領做成順手的預設會製造錯誤歸屬。
 */
import { useCallback, useEffect, useState } from 'react'
import { Handshake, MapPinOff, TriangleAlert, UserRoundPlus } from 'lucide-react'

type Suggestion = {
  customerId: string
  customerName: string
  customerCity: string
  customerDistrict: string
  customerType: string
  salesperson: string
  tier: 'outside-territory' | 'no-territory'
  visitCount: number
  looksDeveloping: boolean
  contested: boolean
  otherVisitors: string[]
  lastVisitDate: string
}

export function ClaimSuggestionsPanel() {
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [canActOnContested, setCanAct] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bd/claim-suggestions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '讀取失敗')
      setItems(json.items ?? [])
      setCanAct(Boolean(json.canActOnContested))
    } catch (e: any) {
      setError(e?.message ?? '讀取待認領建議失敗')
      setItems([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (s: Suggestion, action: 'claim' | 'support') => {
    setBusy(s.customerId); setError(''); setDone('')
    try {
      const res = await fetch('/api/bd/claim-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, customerId: s.customerId, salesperson: s.salesperson }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '處理失敗')
      setItems((cur) => (cur ?? []).filter((x) => x.customerId !== s.customerId))
      setDone(action === 'claim'
        ? `已認領 ${s.customerName}，之後這家算你的。`
        : `已把 ${s.customerName} 記為跨區支援，不會再問你。`)
    } catch (e: any) {
      setError(e?.message ?? '處理失敗')
    } finally { setBusy('') }
  }

  if (items !== null && items.length === 0 && !error) return null

  return (
    <div className="card-soft p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">客情回報後續</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">待認領建議</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            你回報過、但目前還沒有人負責的客戶。在你轄區內的已經自動認領，這裡只列需要你判斷的。
          </p>
        </div>
        {items && items.length > 0 && (
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{items.length} 筆</span>
        )}
      </div>

      {done && <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-2.5 text-sm text-stone-600">{done}</p>}
      {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      {items === null && <p className="mt-4 text-sm text-stone-400">載入中…</p>}

      <div className="mt-4 space-y-2.5">
        {(items ?? []).map((s) => {
          const blocked = s.contested && !canActOnContested
          return (
            <div key={s.customerId} className="rounded-2xl bg-white p-4 ring-1 ring-stone-900/[0.06]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-stone-800">{s.customerName}</span>
                {s.customerType && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">{s.customerType}</span>}
                {s.looksDeveloping && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                    <UserRoundPlus className="size-3" />你回報過 {s.visitCount} 次
                  </span>
                )}
                {s.tier === 'no-territory' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">
                    <MapPinOff className="size-3" />你尚未設定轄區
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-stone-400">
                {s.customerCity}{s.customerDistrict}
                {s.lastVisitDate && ` · 最後回報 ${s.lastVisitDate}`}
                {s.tier === 'outside-territory' && ' · 不在你的轄區內'}
              </p>

              {s.contested && (
                <p className="mt-2 inline-flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>{s.otherVisitors.join('、')} 也拜訪過這家客戶，{canActOnContested ? '請確認歸屬後再認領。' : '認領需由主管核可。'}</span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => act(s, 'support')}
                  disabled={busy === s.customerId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95 disabled:opacity-40">
                  <Handshake className="size-3.5" />只是支援，不認領
                </button>
                <button
                  onClick={() => act(s, 'claim')}
                  disabled={busy === s.customerId || blocked}
                  title={blocked ? '此客戶歸屬有爭議，需主管核可' : undefined}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40 disabled:shadow-none">
                  <UserRoundPlus className="size-3.5" />認領這家客戶
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-stone-400">
        標為「只是支援」會同時建立一筆跨區支援報備，之後不會再問你這家。認領則會把客戶主檔的負責業務寫成你，只在該客戶仍無人負責時生效。
      </p>
    </div>
  )
}
