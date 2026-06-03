'use client'

import { useEffect, useState } from 'react'
import type { PricingItem } from '@/lib/system-notion'

const BRANDS = ['Zirkonzahn', 'Zebris', 'Gencore', 'Dentbird', 'BSM', 'Asiga', 'Cobra', 'MODJAW', '3Shape', 'Fair']

const BRAND_STYLE: Record<string, string> = {
  Zirkonzahn: 'bg-gray-100 text-gray-700',
  Zebris:     'bg-green-100 text-green-700',
  Gencore:    'bg-purple-100 text-purple-700',
  Dentbird:   'bg-blue-100 text-blue-700',
  BSM:        'bg-gray-100 text-gray-600',
  Asiga:      'bg-orange-100 text-orange-700',
  Cobra:      'bg-red-100 text-red-700',
  MODJAW:     'bg-pink-100 text-pink-700',
  '3Shape':   'bg-yellow-100 text-yellow-700',
  Fair:       'bg-amber-100 text-amber-700',
}

type FormState = {
  name: string; brand: string; costPrice: string; listPrice: string
  discountRate: string; floorPrice: string; note: string
}
const EMPTY: FormState = { name: '', brand: 'Zirkonzahn', costPrice: '', listPrice: '', discountRate: '', floorPrice: '', note: '' }

function toNum(s: string) { return parseFloat(s) || 0 }
const fmtMoney = (n: number) => n ? `$${n.toLocaleString('zh-TW')}` : '—'
const fmtPct = (n: number) => n ? `${n.toFixed(1)}%` : '—'

export function PricingContent() {
  const [items, setItems] = useState<PricingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterBrand, setFilterBrand] = useState('全部')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/pricing').then(r => r.json())
      .then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function openCreate() { setForm(EMPTY); setEditId(null); setShowForm(true) }
  function openEdit(item: PricingItem) {
    setForm({
      name: item.name, brand: item.brand || 'Zirkonzahn', note: item.note,
      costPrice: item.costPrice ? String(item.costPrice) : '',
      listPrice: item.listPrice ? String(item.listPrice) : '',
      discountRate: item.discountRate != null ? String(item.discountRate * 100) : '',
      floorPrice: item.floorPrice ? String(item.floorPrice) : '',
    })
    setEditId(item.id); setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name) return
    setSaving(true)
    const discountRate = toNum(form.discountRate) / 100
    const payload = {
      name: form.name, brand: form.brand, note: form.note,
      costPrice: toNum(form.costPrice), listPrice: toNum(form.listPrice),
      discountRate, floorPrice: toNum(form.floorPrice),
    }
    if (editId) {
      await fetch(`/api/pricing/${editId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const actualPrice = payload.listPrice * (1 - discountRate)
      const grossProfit = actualPrice - payload.costPrice
      setItems(prev => prev.map(i => i.id === editId ? {
        ...i, ...payload,
        actualPrice,
        grossProfit,
        grossMargin: actualPrice > 0 ? Math.round(grossProfit / actualPrice * 10000) / 100 : 0,
      } : i))
    } else {
      const res = await fetch('/api/pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) { const created = await res.json(); setItems(prev => [...prev, created]) }
    }
    setSaving(false); setShowForm(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('確定要刪除此品項？')) return
    await fetch(`/api/pricing/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const filtered = items
    .filter(i => filterBrand === '全部' || i.brand === filterBrand)
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap items-center">
          <input
            className="input text-sm py-1 px-3 w-40"
            placeholder="搜尋品名…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="input text-sm py-1 px-2" value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
            <option value="全部">全部品牌</option>
            {BRANDS.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <button onClick={openCreate} className="button-primary">+ 新增品項</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-gray-400">載入中…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center text-gray-400">
          尚無品項，點擊「新增品項」開始建立
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">報價成本試算</span>
            <span className="text-sm text-gray-400">{filtered.length} 筆</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">品名</th>
                  <th className="px-4 py-3 text-left font-medium">品牌</th>
                  <th className="px-4 py-3 text-right font-medium">進貨成本</th>
                  <th className="px-4 py-3 text-right font-medium">定價</th>
                  <th className="px-4 py-3 text-right font-medium">折扣率</th>
                  <th className="px-4 py-3 text-right font-medium">實際售價</th>
                  <th className="px-4 py-3 text-right font-medium">最低售價</th>
                  <th className="px-4 py-3 text-right font-medium">毛利</th>
                  <th className="px-4 py-3 text-right font-medium">毛利率</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(item => {
                  const belowFloor = item.floorPrice > 0 && item.actualPrice < item.floorPrice
                  return (
                    <tr key={item.id} className={`hover:bg-gray-50 ${belowFloor ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {item.name}
                        {belowFloor && <span className="ml-1 text-xs text-red-500">⚠️ 低於底價</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BRAND_STYLE[item.brand] ?? 'bg-gray-100 text-gray-600'}`}>
                          {item.brand || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmtMoney(item.costPrice)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{fmtMoney(item.listPrice)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {item.discountRate ? `${(item.discountRate * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">{fmtMoney(item.actualPrice)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{fmtMoney(item.floorPrice)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${(item.grossProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtMoney(item.grossProfit)}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${(item.grossMargin || 0) >= 30 ? 'text-green-600' : (item.grossMargin || 0) >= 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {fmtPct(item.grossMargin)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => openEdit(item)} className="text-xs text-blue-600 hover:underline">編輯</button>
                          <button onClick={() => handleDelete(item.id)} className="text-xs text-red-500 hover:underline">刪除</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form onSubmit={handleSave} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editId ? '編輯品項' : '新增品項'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div>
              <label className="label">品名 *</label>
              <input className="input w-full" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：Prettau 3 Dispersive" />
            </div>

            <div>
              <label className="label">品牌</label>
              <select className="input w-full" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
                {BRANDS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">進貨成本（元）</label>
                <input type="number" className="input w-full" min="0" value={form.costPrice} onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))} placeholder="0" />
              </div>
              <div><label className="label">定價（元）</label>
                <input type="number" className="input w-full" min="0" value={form.listPrice} onChange={e => setForm(f => ({ ...f, listPrice: e.target.value }))} placeholder="0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">折扣率（%，例如 10 = 九折）</label>
                <input type="number" className="input w-full" min="0" max="100" step="0.1" value={form.discountRate} onChange={e => setForm(f => ({ ...f, discountRate: e.target.value }))} placeholder="0" />
              </div>
              <div><label className="label">最低售價（底價）</label>
                <input type="number" className="input w-full" min="0" value={form.floorPrice} onChange={e => setForm(f => ({ ...f, floorPrice: e.target.value }))} placeholder="0" />
              </div>
            </div>

            {/* Live preview */}
            {(form.costPrice || form.listPrice) && (() => {
              const cost = toNum(form.costPrice)
              const list = toNum(form.listPrice)
              const disc = toNum(form.discountRate) / 100
              const actual = list * (1 - disc)
              const profit = actual - cost
              const margin = actual > 0 ? (profit / actual * 100).toFixed(1) : null
              return (
                <div className="rounded-lg bg-gray-50 p-3 text-sm grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-xs text-gray-400">實際售價</p><p className="font-semibold text-blue-600">${actual.toLocaleString()}</p></div>
                  <div><p className="text-xs text-gray-400">毛利</p><p className={`font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>${profit.toLocaleString()}</p></div>
                  <div><p className="text-xs text-gray-400">毛利率</p><p className={`font-semibold ${parseFloat(margin||'0') >= 30 ? 'text-green-600' : 'text-yellow-600'}`}>{margin ? `${margin}%` : '—'}</p></div>
                </div>
              )
            })()}

            <div><label className="label">備註</label>
              <textarea className="input w-full" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="button-secondary">取消</button>
              <button type="submit" disabled={saving} className="button-primary">{saving ? '儲存中…' : editId ? '儲存' : '建立'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
