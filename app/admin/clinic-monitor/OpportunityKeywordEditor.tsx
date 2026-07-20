'use client'

import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import type { OpportunitySignal } from '@/lib/opportunity-signals'

const EMPTY_SIGNAL: OpportunitySignal = {
  tag: '',
  gold: false,
  keywords: [],
  implication: '',
  productLines: [],
}

function splitLines(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,，、]+/).map((item) => item.trim()).filter(Boolean)))
}

export default function OpportunityKeywordEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [signals, setSignals] = useState<OpportunitySignal[]>([])
  const [keywordText, setKeywordText] = useState<string[]>([])
  const [productText, setProductText] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    fetch('/api/opportunity/keywords')
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '讀取詞庫失敗')
        const loaded: OpportunitySignal[] = data.signals ?? []
        setSignals(loaded)
        setKeywordText(loaded.map((signal) => signal.keywords.join('\n')))
        setProductText(loaded.map((signal) => signal.productLines.join('、')))
      })
      .catch((reason) => setError(reason?.message || '讀取詞庫失敗'))
      .finally(() => setLoading(false))
  }, [])

  const update = (index: number, patch: Partial<OpportunitySignal>) => {
    setSignals((current) => current.map((signal, position) => position === index ? { ...signal, ...patch } : signal))
    setSaved('')
  }

  const save = async () => {
    setSaving(true); setError(''); setSaved('')
    try {
      const response = await fetch('/api/opportunity/keywords', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '儲存失敗')
      setSignals(data.signals ?? signals)
      setSaved('已儲存。下一次掃描會使用新版詞庫；既有客戶標籤不會自動改動。')
      onSaved()
    } catch (reason: any) {
      setError(reason?.message || '儲存關鍵字庫失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06]" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-stone-900/[0.06] px-5 py-4 sm:px-7">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">搜尋規則</p>
            <h2 className="mt-1 text-xl font-bold text-stone-800">商機關鍵字庫</h2>
            <p className="mt-1 text-sm text-stone-500">每組任一關鍵字命中，就會在預覽中產生對應標籤。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-600 active:scale-95" aria-label="關閉"><X className="size-5" /></button>
        </header>

        <div className="overflow-y-auto px-4 py-5 sm:px-7">
          <div className="mb-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 ring-1 ring-amber-200/70">
            關鍵字越短、語意越廣，誤判率越高。避免單獨使用「當日完成」「列印」「數位」；優先使用「一日假牙」「牙科3D列印」「椅旁CAD/CAM」等完整詞組。
          </div>

          {loading ? <p className="py-12 text-center text-sm text-stone-400">載入詞庫中…</p> : (
            <div className="space-y-4">
              {signals.map((signal, index) => (
                <section key={index} className="card-soft p-4 sm:p-5">
                  <div className="grid gap-4 lg:grid-cols-[minmax(150px,.55fr)_minmax(0,1.45fr)]">
                    <div className="space-y-3">
                      <label className="block text-xs font-semibold text-stone-500">分類名稱
                        <input value={signal.tag} onChange={(event) => update(index, { tag: event.target.value })} className="input-soft mt-1.5 w-full" placeholder="例如：CAD/CAM" />
                      </label>
                      <label className="flex min-h-11 items-center gap-2 rounded-2xl bg-white px-3 text-sm text-stone-600 ring-1 ring-stone-900/[0.06]">
                        <input type="checkbox" checked={Boolean(signal.gold)} onChange={(event) => update(index, { gold: event.target.checked })} className="size-4 accent-brand-500" />
                        設為優先商機
                      </label>
                      <button onClick={() => {
                        setSignals((current) => current.filter((_, position) => position !== index))
                        setKeywordText((current) => current.filter((_, position) => position !== index))
                        setProductText((current) => current.filter((_, position) => position !== index))
                      }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-rose-500 transition-all hover:bg-rose-50 active:scale-95">
                        <Trash2 className="size-4" /> 刪除此分類
                      </button>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-xs font-semibold text-stone-500">關鍵字
                        <textarea value={keywordText[index] ?? ''} onChange={(event) => {
                          const value = event.target.value
                          setKeywordText((current) => current.map((item, position) => position === index ? value : item))
                          update(index, { keywords: splitLines(value) })
                        }} rows={5} className="input-soft mt-1.5 w-full resize-y py-3" placeholder="一行一個關鍵字" />
                      </label>
                      <label className="block text-xs font-semibold text-stone-500">命中後的判讀提醒
                        <input value={signal.implication} onChange={(event) => update(index, { implication: event.target.value })} className="input-soft mt-1.5 w-full" placeholder="提醒使用者如何判斷這個訊號" />
                      </label>
                      <label className="block text-xs font-semibold text-stone-500">可切入產品線
                        <input value={productText[index] ?? ''} onChange={(event) => {
                          const value = event.target.value
                          setProductText((current) => current.map((item, position) => position === index ? value : item))
                          update(index, { productLines: splitLines(value) })
                        }} className="input-soft mt-1.5 w-full" placeholder="以逗號或頓號分隔" />
                      </label>
                    </div>
                  </div>
                </section>
              ))}
              <button onClick={() => {
                setSignals((current) => [...current, { ...EMPTY_SIGNAL }])
                setKeywordText((current) => [...current, ''])
                setProductText((current) => [...current, ''])
              }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-300 bg-brand-50/40 text-sm font-semibold text-brand-700 transition-all hover:bg-brand-50 active:scale-[0.99]">
                <Plus className="size-4" /> 新增商機分類
              </button>
            </div>
          )}
          {error && <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
          {saved && <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{saved}</p>}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-stone-900/[0.06] bg-white/90 px-5 py-4 backdrop-blur sm:flex-row sm:justify-end sm:px-7">
          <button onClick={onClose} className="min-h-11 rounded-full px-5 text-sm font-medium text-stone-500 transition-all hover:bg-stone-100 active:scale-95">關閉</button>
          <button onClick={save} disabled={loading || saving || signals.length === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand-500 px-6 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
            <Save className="size-4" /> {saving ? '儲存中…' : '儲存並套用'}
          </button>
        </footer>
      </div>
    </div>
  )
}
