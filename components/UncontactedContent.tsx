'use client'

/**
 * 業務開發 › 未往來名單
 * 客戶主檔已建檔、但公司從未往來的機構（定義與市場監控頁「未曾往來」同一份：lib/notion/uncontacted.ts）。
 * 主管可篩選、勾選「未分派」者指派給業務做陌生開發；業務只看自己名下。
 */
import { useEffect, useMemo, useState } from 'react'

const UNASSIGNED = '__unassigned__'

type Facet = { value: string; n: number }
type Row = {
  id: string; name: string; type: string; city: string; district: string
  status: string; devStage: string; salesperson: string; headcount: number; hasCode: boolean
}
type Payload = {
  isManager: boolean; visitedAvailable: boolean
  activeTotal: number; engagedTotal: number; uncontactedTotal: number; scopeTotal: number
  matched: number; items: Row[]
  facets: { type: Facet[]; city: Facet[]; district: Facet[]; owner: Facet[] }
  assignTargets: string[]
}

const ownerLabel = (v: string) => (v === UNASSIGNED || !v ? '未分派' : v)

export default function UncontactedContent() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [type, setType] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [owner, setOwner] = useState('')
  const [minHeadcount, setMinHeadcount] = useState(0)
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [preview, setPreview] = useState<{ willAssign: number; rejected: { name: string; reason: string }[] } | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t) }, [q])

  async function load() {
    setLoading(true); setError('')
    try {
      const qs = new URLSearchParams()
      if (type) qs.set('type', type)
      if (city) qs.set('city', city)
      if (district) qs.set('district', district)
      if (owner) qs.set('owner', owner)
      if (minHeadcount) qs.set('minHeadcount', String(minHeadcount))
      if (qDebounced) qs.set('q', qDebounced)
      const res = await fetch('/api/bd/uncontacted?' + qs.toString())
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? '讀取失敗'); return }
      setData(json as Payload)
    } catch (e: any) { setError(e?.message ?? '讀取失敗') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [type, city, district, owner, minHeadcount, qDebounced]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(new Set()); setPreview(null) }, [type, city, district, owner, minHeadcount, qDebounced])

  const items = data?.items ?? []
  const selectable = useMemo(() => items.filter((r) => !r.salesperson), [items])
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id))

  function toggle(id: string) {
    setPreview(null)
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleAll() {
    setPreview(null)
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))
  }

  async function assign(dryRun: boolean) {
    if (!target || selected.size === 0) return
    setAssigning(true); setMsg('')
    try {
      const res = await fetch('/api/bd/uncontacted/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), salesperson: target, dryRun }),
      })
      const json = await res.json()
      if (!res.ok) { setMsg(`❌ ${json.error ?? '分派失敗'}`); return }
      if (dryRun) { setPreview({ willAssign: json.willAssign, rejected: json.rejected ?? [] }); return }
      setMsg(`✅ 已分派 ${json.assigned} 家給 ${json.salesperson}${json.skipped ? `（跳過 ${json.skipped}）` : ''}`)
      setSelected(new Set()); setPreview(null)
      await load()
    } catch (e: any) { setMsg(`❌ ${e?.message ?? '分派失敗'}`) }
    finally { setAssigning(false) }
  }

  return (
    <div className="space-y-5">
      {/* 名詞定義：先講清楚這份名單是什麼 */}
      <div className="card-soft p-4 sm:p-5 text-sm text-stone-600 leading-relaxed space-y-1.5">
        <p className="font-semibold text-stone-800">這份名單是什麼</p>
        <p>
          <b>未往來</b>＝客戶主檔<b>已建檔</b>、但公司<b>從未往來</b>的機構。
          「已往來」要有實證，兩者任一成立就不列入：①開發狀態標「公司既有客戶」 ②客情紀錄裡出現過。
          已歇業／停業／撤銷不列入。
        </p>
        <p className="text-xs text-stone-400">
          <b>規模</b>＝牙體技術師數＋牙體技術生數（0 表示主檔未填）。
          <b>負責</b>＝主檔「負責業務」；未分派者才能在這裡指派。由「公司」持有的請走中央管理的公司客戶調度流程。
          衛福部有、但主檔還沒建檔的機構不在這裡，請看市場監控頁的「衛福部有、主檔未建檔」。
        </p>
        {data && (
          <p className="text-xs text-stone-500 pt-1">
            有效客戶 {data.activeTotal.toLocaleString()}｜已往來 {data.engagedTotal.toLocaleString()}｜
            未往來 <b className="text-brand-700">{data.uncontactedTotal.toLocaleString()}</b>
            {!data.isManager && <>｜我名下 <b className="text-brand-700">{data.scopeTotal.toLocaleString()}</b></>}
          </p>
        )}
      </div>

      {data && !data.visitedAvailable && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          ⚠ 客情紀錄集合尚未備妥（夜間排程未完成），目前只用「公司既有客戶」標記判斷，名單會偏多；此時無法分派。
        </div>
      )}

      {/* 篩選 */}
      <div className="card-soft p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="select-soft rounded-full px-3 py-1.5 text-sm">
          <option value="">全部類型</option>
          {data?.facets.type.map((f) => <option key={f.value} value={f.value}>{f.value}（{f.n}）</option>)}
        </select>
        <select value={city} onChange={(e) => { setCity(e.target.value); setDistrict('') }} className="select-soft rounded-full px-3 py-1.5 text-sm">
          <option value="">全部縣市</option>
          {data?.facets.city.map((f) => <option key={f.value} value={f.value}>{f.value}（{f.n}）</option>)}
        </select>
        {city && (
          <select value={district} onChange={(e) => setDistrict(e.target.value)} className="select-soft rounded-full px-3 py-1.5 text-sm">
            <option value="">全部行政區</option>
            {data?.facets.district.map((f) => <option key={f.value} value={f.value}>{f.value}（{f.n}）</option>)}
          </select>
        )}
        {data?.isManager && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="select-soft rounded-full px-3 py-1.5 text-sm">
            <option value="">全部負責</option>
            {data.facets.owner.map((f) => <option key={f.value} value={f.value}>{ownerLabel(f.value)}（{f.n}）</option>)}
          </select>
        )}
        <select value={minHeadcount} onChange={(e) => setMinHeadcount(Number(e.target.value))} className="select-soft rounded-full px-3 py-1.5 text-sm">
          <option value={0}>不限規模</option>
          <option value={1}>規模 ≥ 1 人</option>
          <option value={3}>規模 ≥ 3 人</option>
          <option value={5}>規模 ≥ 5 人</option>
          <option value={10}>規模 ≥ 10 人</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋機構名稱"
          className="input-soft min-w-[180px] flex-1 rounded-full px-4 py-1.5 text-sm" />
      </div>

      {/* 分派列（主管） */}
      {data?.isManager && (
        <div className="card-soft p-3 sm:p-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-500">已勾選 <b className="text-stone-800 tabular-nums">{selected.size}</b> 家（只能勾未分派者）</span>
          <select value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null) }} className="select-soft rounded-full px-3 py-1.5 text-sm">
            <option value="">選擇業務…</option>
            {data.assignTargets.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={() => assign(true)} disabled={!target || selected.size === 0 || assigning || !data.visitedAvailable}
            className="px-4 py-1.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 disabled:opacity-50 active:scale-95 transition-all">
            預覽分派
          </button>
          {preview && (
            <button onClick={() => assign(false)} disabled={assigning || preview.willAssign === 0}
              className="px-4 py-1.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 disabled:opacity-50 active:scale-95 transition-all">
              {assigning ? '分派中…' : `確認分派 ${preview.willAssign} 家給 ${target}`}
            </button>
          )}
          {preview && preview.rejected.length > 0 && (
            <span className="text-xs text-amber-700">將跳過 {preview.rejected.length} 家：{preview.rejected.slice(0, 3).map((r) => `${r.name || '?'}（${r.reason}）`).join('、')}{preview.rejected.length > 3 ? '…' : ''}</span>
          )}
          {msg && <span className="text-xs text-stone-600 w-full">{msg}</span>}
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      {/* 清單 */}
      <div className="card-soft overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3 border-b border-stone-900/[0.06] text-xs text-stone-400">
          {data?.isManager && (
            <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectable.length === 0}
              className="accent-brand-500" aria-label="全選未分派" />
          )}
          <span>
            {loading ? '讀取中…（首次可能需要約一分鐘）' : <>符合 <b className="text-stone-700">{(data?.matched ?? 0).toLocaleString()}</b> 家
              {data && data.matched > items.length && <>，依規模顯示前 {items.length} 家</>}</>}
          </span>
        </div>
        {!loading && items.length === 0 && (
          <div className="py-12 text-center text-sm text-stone-400">沒有符合條件的機構</div>
        )}
        <div className="divide-y divide-stone-50">
          {items.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
              {data?.isManager && (
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} disabled={!!r.salesperson}
                  className="accent-brand-500 disabled:opacity-30" aria-label={`勾選 ${r.name}`} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`/customers/${r.id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-stone-900 hover:text-brand-700">{r.name}</a>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{r.type}</span>
                  {!r.hasCode && <span className="text-[10px] px-2 py-0.5 rounded-full bg-cream-200 text-stone-500">無機構代碼</span>}
                </div>
                <div className="text-xs text-stone-400 mt-0.5">
                  {r.city}{r.district && ` ${r.district}`}
                  {r.devStage && ` · ${r.devStage}`}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums text-stone-700">{r.headcount > 0 ? `${r.headcount} 人` : '—'}</div>
                <div className={`text-[11px] ${r.salesperson ? 'text-stone-500' : 'text-brand-600'}`}>{ownerLabel(r.salesperson)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
