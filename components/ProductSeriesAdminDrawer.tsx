'use client'

import { useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'
import { useBodyScrollLock, useDialogFocus } from '@/lib/use-dialog-focus'

interface CatalogItem {
  code: string
  name: string
  brand: string
}

interface ProductFamily {
  id: string
  seriesCode: string
  seriesName: string
  brand: string
  skuMap?: Record<string, string>
  coveredSkuCodes?: string[]
  manualAssignedSkuCodes?: string[]
  source?: 'catalog' | 'notion'
}

interface Props {
  families: ProductFamily[]
  allItems: CatalogItem[]
  onClose: () => void
  onChanged: () => Promise<void>
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null)
  return data?.error || `${fallback}（HTTP ${response.status}）`
}

export function ProductSeriesAdminDrawer({ families, allItems, onClose, onChanged }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(families[0]?.id ?? '')
  const [memberQuery, setMemberQuery] = useState('')
  const [newSeries, setNewSeries] = useState({ seriesCode: '', seriesName: '', brand: '' })
  const [renaming, setRenaming] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useDialogFocus(dialogRef, onClose)
  useBodyScrollLock()

  const filteredFamilies = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return families
    return families.filter((family) =>
      family.seriesName.toLowerCase().includes(keyword)
      || family.seriesCode.toLowerCase().includes(keyword)
      || family.brand.toLowerCase().includes(keyword),
    )
  }, [families, query])

  const selected = families.find((family) => family.id === selectedId) ?? filteredFamilies[0]
  const owningFamilyBySku = useMemo(() => {
    const owners = new Map<string, ProductFamily>()
    for (const family of families) {
      for (const skuCode of explicitFamilySkuCodes(family)) {
        if (!owners.has(skuCode)) owners.set(skuCode, family)
      }
    }
    return owners
  }, [families])
  const memberCodes = useMemo(() => new Set(selected ? explicitFamilySkuCodes(selected) : []), [selected])
  const manualCodes = useMemo(() => new Set(selected?.manualAssignedSkuCodes ?? []), [selected])
  const memberItems = useMemo(
    () => allItems.filter((item) => memberCodes.has(item.code)),
    [allItems, memberCodes],
  )
  const candidates = useMemo(() => {
    const keyword = memberQuery.trim().toLowerCase()
    if (!keyword) return []
    return allItems
      .filter((item) => !memberCodes.has(item.code))
      .filter((item) => `${item.code} ${item.name} ${item.brand}`.toLowerCase().includes(keyword))
      .slice(0, 20)
  }, [allItems, memberCodes, memberQuery])

  async function createSeries() {
    setBusy('create')
    setError('')
    try {
      const response = await fetch('/api/products/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSeries),
      })
      if (!response.ok) throw new Error(await readError(response, '建立系列失敗'))
      const created = await response.json()
      await onChanged()
      setSelectedId(`custom:${created.seriesCode}`)
      setNewSeries({ seriesCode: '', seriesName: '', brand: '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '建立系列失敗')
    } finally {
      setBusy('')
    }
  }

  async function renameSeries() {
    if (!selected) return
    const name = renaming.trim()
    if (!name) { setError('系列名稱不可空白'); return }
    setBusy('rename')
    setError('')
    try {
      const response = await fetch(`/api/products/series/${encodeURIComponent(selected.seriesCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesName: name, brand: selected.brand }),
      })
      if (!response.ok) throw new Error(await readError(response, '系列改名失敗'))
      await onChanged()
      setRenaming('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '系列改名失敗')
    } finally {
      setBusy('')
    }
  }

  async function assignSku(skuCode: string, familyId: string, previousFamily?: ProductFamily) {
    if (familyId && previousFamily && previousFamily.id !== familyId) {
      const confirmed = window.confirm(`此品項目前屬於「${previousFamily.seriesName}」。確定要移到「${selected?.seriesName ?? familyId}」嗎？`)
      if (!confirmed) return
    }
    setBusy(skuCode)
    setError('')
    try {
      const response = await fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId }),
      })
      if (!response.ok) throw new Error(await readError(response, '成員更新失敗'))
      await onChanged()
      setMemberQuery('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '成員更新失敗')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        ref={dialogRef}
        initial={{ x: reduceMotion ? 0 : '100%' }}
        animate={{ x: 0 }}
        exit={{ x: reduceMotion ? 0 : '100%' }}
        className="relative ml-auto flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-[#fcfbf8] shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-l-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-admin-title"
        tabIndex={-1}
      >
        <header className="glass-bar flex items-start justify-between border-b border-stone-900/[0.06] px-4 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">中央管理後台</p>
            <h2 id="series-admin-title" className="mt-1 text-xl font-bold text-stone-800">系列群組管理</h2>
            <p className="mt-1 text-xs text-stone-500">建立、改名及調整手動歸類；ERP 貨號與品名不會被修改。</p>
          </div>
          <button type="button" onClick={onClose} data-dialog-initial-focus aria-label="關閉系列管理" className="flex h-11 w-11 items-center justify-center rounded-full text-stone-400 transition-all hover:bg-stone-100 active:scale-95">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

          <section className="card-soft p-4 sm:p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">建立新系列</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input className="input-soft min-h-11" value={newSeries.seriesCode} onChange={(event) => setNewSeries((value) => ({ ...value, seriesCode: event.target.value }))} placeholder="系列代碼，例如 SUN-KIT" aria-label="新系列代碼" />
              <input className="input-soft min-h-11 sm:col-span-2" value={newSeries.seriesName} onChange={(event) => setNewSeries((value) => ({ ...value, seriesName: event.target.value }))} placeholder="系列名稱" aria-label="新系列名稱" />
              <input className="input-soft min-h-11 sm:col-span-2" value={newSeries.brand} onChange={(event) => setNewSeries((value) => ({ ...value, brand: event.target.value }))} placeholder="品牌（可稍後補）" aria-label="新系列品牌" />
              <button type="button" onClick={createSeries} disabled={Boolean(busy)} className="min-h-11 rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">{busy === 'create' ? '建立中…' : '建立系列'}</button>
            </div>
          </section>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <section className="card-soft overflow-hidden p-0">
              <div className="border-b border-stone-900/[0.06] p-3">
                <input type="search" className="input-soft min-h-11 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋系列…" aria-label="搜尋系列" />
              </div>
              <div className="max-h-80 overflow-y-auto p-2 md:max-h-[56vh]">
                {filteredFamilies.map((family) => (
                  <button key={family.id} type="button" aria-pressed={selected?.id === family.id} onClick={() => { setSelectedId(family.id); setRenaming(''); setMemberQuery(''); setError('') }} className={`mb-1 flex min-h-12 w-full items-center rounded-2xl px-3 py-2 text-left transition-all active:scale-[0.99] ${selected?.id === family.id ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : 'text-stone-700 hover:bg-stone-50'}`}>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{family.seriesName}</span><span className="block truncate font-mono text-[10px] text-stone-400">{family.seriesCode}</span></span>
                    <span className="ml-2 text-[11px] text-stone-400">{explicitFamilySkuCodes(family).length}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="card-soft p-4 sm:p-5">
              {selected ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">系列設定</p>
                    <h3 className="mt-1 text-lg font-bold text-stone-800">{selected.seriesName}</h3>
                    <p className="font-mono text-xs text-stone-400">{selected.seriesCode} · {selected.source === 'notion' ? '後台建立' : '目錄系列'}</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input className="input-soft min-h-11 flex-1" value={renaming} onChange={(event) => setRenaming(event.target.value)} placeholder="輸入新的系列名稱" aria-label="新的系列名稱" />
                      <button type="button" onClick={renameSeries} disabled={Boolean(busy)} className="min-h-11 rounded-full border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95 disabled:opacity-50">{busy === 'rename' ? '儲存中…' : '儲存名稱'}</button>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">加入品項</p>
                    <input type="search" className="input-soft mt-2 min-h-11 w-full" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="輸入貨號或品名…" aria-label="搜尋要加入的品項" />
                    {candidates.length > 0 && (
                      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-stone-50 p-2">
                        {candidates.map((item) => {
                          const previousFamily = owningFamilyBySku.get(item.code)
                          return (
                            <button key={item.code} type="button" onClick={() => assignSku(item.code, selected.id, previousFamily)} disabled={Boolean(busy)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white px-3 py-2 text-left transition-all hover:bg-brand-50 active:scale-[0.99] disabled:opacity-50">
                              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-stone-700">{item.name}</span><span className="font-mono text-[11px] text-stone-400">{item.code}</span>{previousFamily && <span className="mt-0.5 block truncate text-[10px] text-amber-600">目前：{previousFamily.seriesName}</span>}</span><span className="text-xs font-semibold text-brand-600">{previousFamily ? '移入' : '加入'}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">目前成員</p><span className="text-xs text-stone-400">{memberItems.length} 項</span></div>
                    <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
                      {memberItems.map((item) => (
                        <div key={item.code} className="flex min-h-12 items-center gap-3 rounded-2xl bg-stone-50 px-3 py-2">
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-stone-700">{item.name}</span><span className="font-mono text-[11px] text-stone-400">{item.code}</span></span>
                          {manualCodes.has(item.code) ? <button type="button" onClick={() => assignSku(item.code, '')} disabled={Boolean(busy)} className="min-h-11 rounded-full px-3 text-xs font-semibold text-red-500 transition-all hover:bg-red-50 active:scale-95 disabled:opacity-50">移除</button> : <span className="text-[10px] text-stone-400">目錄固定</span>}
                        </div>
                      ))}
                      {memberItems.length === 0 && <p className="py-6 text-center text-sm text-stone-400">尚未加入品項</p>}
                    </div>
                  </div>
                </div>
              ) : <p className="py-10 text-center text-sm text-stone-400">請先選擇系列</p>}
            </section>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
