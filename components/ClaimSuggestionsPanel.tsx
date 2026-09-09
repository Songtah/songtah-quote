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
import { Handshake, MapPin, MapPinOff, TriangleAlert, UserRoundPlus, Users } from 'lucide-react'

type Suggestion = {
  customerId: string
  customerName: string
  customerCity: string
  customerDistrict: string
  customerType: string
  salesperson: string
  tier: 'outside-territory' | 'no-territory' | 'in-territory-backlog' | 'territory-visited-by-others'
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
  const [bulkPreview, setBulkPreview] = useState<{ total: number; willClaim: number; excludedContested: number; sample: { name: string; area: string; visitCount: number }[] } | null>(null)
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

  // 轄區歸屬確定的兩類：自己跑過的舊回報、以及同事跑過但轄區是你的
  const TERRITORY_TIERS = ['in-territory-backlog', 'territory-visited-by-others']
  const backlog = (items ?? []).filter((s) => TERRITORY_TIERS.includes(s.tier) && !s.contested)

  const previewBulk = async () => {
    setBusy('bulk'); setError(''); setDone('')
    try {
      const res = await fetch('/api/bd/claim-suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim-all-in-territory', dryRun: true, salesperson: backlog[0]?.salesperson }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '預覽失敗')
      setBulkPreview(json)
    } catch (e: any) { setError(e?.message ?? '預覽失敗') } finally { setBusy('') }
  }

  const confirmBulk = async () => {
    setBusy('bulk'); setError('')
    try {
      const res = await fetch('/api/bd/claim-suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim-all-in-territory', salesperson: backlog[0]?.salesperson }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '認領失敗')
      setBulkPreview(null)
      setDone(`已認領 ${json.assigned} 家轄區內客戶${json.remaining > 0 ? `，還有 ${json.remaining} 家，可再按一次` : ''}。`)
      await load()
    } catch (e: any) { setError(e?.message ?? '認領失敗') } finally { setBusy('') }
  }

  if (items !== null && items.length === 0 && !error) return null

  return (
    <div className="card-soft p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">客情回報後續</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">待認領建議</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            你回報過、但目前還沒有人負責的客戶。設好轄區之後的新回報會自動認領，這裡列的是需要你確認的。
          </p>
        </div>
        {items && items.length > 0 && (
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{items.length} 筆</span>
        )}
      </div>

      {backlog.length > 0 && (
        <div className="mt-4 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-600/15">
          <p className="text-sm font-semibold text-emerald-800">
            有 {backlog.length} 家在你轄區內、有人跑過、但目前沒有人負責
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-700">
            包含你自己早於轄區設定時回報的，以及同事支援時跑過的。歸屬是確定的（就在你的轄區、無人負責），可以一次認領完。
          </p>
          {!bulkPreview ? (
            <button onClick={previewBulk} disabled={busy === 'bulk'}
              className="mt-3 rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-emerald-800 active:scale-95 disabled:opacity-40">
              {busy === 'bulk' ? '計算中…' : `預覽並一次認領這 ${backlog.length} 家`}
            </button>
          ) : (
            <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-emerald-600/15">
              <p className="text-xs text-stone-600">
                這次會認領 <b className="text-emerald-700">{bulkPreview.willClaim}</b> 家
                {bulkPreview.total > bulkPreview.willClaim && `（共 ${bulkPreview.total} 家，單次上限 100，剩下的可再按一次）`}
                {bulkPreview.excludedContested > 0 && `；另有 ${bulkPreview.excludedContested} 家因歸屬有爭議已排除，需主管逐筆處理`}
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-stone-400">
                {bulkPreview.sample.map((x) => `${x.name}（${x.area}）`).join('、')}
                {bulkPreview.willClaim > bulkPreview.sample.length && ` …等 ${bulkPreview.willClaim} 家`}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => setBulkPreview(null)}
                  className="rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">取消</button>
                <button onClick={confirmBulk} disabled={busy === 'bulk'}
                  className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-emerald-800 active:scale-95 disabled:opacity-40">
                  {busy === 'bulk' ? '認領中…' : `確認認領 ${bulkPreview.willClaim} 家`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
                {s.tier === 'in-territory-backlog' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <MapPin className="size-3" />這區現在是你的轄區
                  </span>
                )}
                {s.tier === 'territory-visited-by-others' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <Users className="size-3" />同事跑過，轄區是你的
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-stone-400">
                {s.customerCity}{s.customerDistrict}
                {s.lastVisitDate && ` · 最後回報 ${s.lastVisitDate}`}
                {s.tier === 'outside-territory' && ' · 不在你的轄區內'}
                {s.tier === 'in-territory-backlog' && ' · 這筆回報早於轄區設定，所以沒有自動認領'}
                {s.tier === 'territory-visited-by-others' && ` · ${s.otherVisitors.join('、')} 跑過但沒有人負責`}
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
        標「這區現在是你的轄區」的，是新增轄區之前就回報過的舊紀錄；標「同事跑過」的是別人支援時留下的紀錄。
        兩者系統都不會回頭自動認領，需要你按一下確認。
      </p>
    </div>
  )
}
