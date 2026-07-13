/**
 * lib/opportunity-signals.ts — 商機關鍵字偵測引擎(純邏輯 leaf,不 import 任何領域檔)
 *
 * 用途:對「診所官網文字 / Google 商家簡介 / 評論」跑關鍵字字典,推論該機構的
 * 內部產能與採購潛力(例:出現「一日假牙」→ 院內多半有技工室/數位產線 → 設備+材料直客)。
 * 命中結果附「證據句」,供人工確認後才寫回主檔的「商機標籤」。
 *
 * 字典在 `data/opportunity-keywords.json`(你和老闆可直接編輯);比對為「正規化後 includes」,
 * 大小寫/全半形不敏感。同一標籤被多個關鍵字命中時只回一筆,避免同義詞灌爆清單。
 */
import dict from '@/data/opportunity-keywords.json'

export type OpportunitySignal = {
  tag: string
  keywords: string[]
  implication: string
  productLines: string[]
}

export const SIGNAL_DICTIONARY: OpportunitySignal[] = (dict.signals ?? []) as OpportunitySignal[]

export type SignalHit = {
  tag: string
  keyword: string
  evidence: string       // 命中處的上下文句子(給人工判斷)
  implication: string
  productLines: string[]
}

// 正規化:全形→半形英數、去空白、轉小寫。中文原樣保留以維持關鍵字命中。
function normalize(s: string): string {
  return (s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toLowerCase()
}

// 從原文抓命中詞附近的一句話當證據(以標點/換行切句;找不到則取 ±40 字窗)
function extractEvidence(rawText: string, keyword: string): string {
  const sentences = rawText.split(/[。！？\n\r;；]+/).map((x) => x.trim()).filter(Boolean)
  const nk = normalize(keyword)
  for (const sen of sentences) {
    if (normalize(sen).includes(nk)) {
      return sen.length > 80 ? sen.slice(0, 80) + '…' : sen
    }
  }
  const idx = normalize(rawText).indexOf(nk)
  if (idx < 0) return ''
  const start = Math.max(0, idx - 40)
  return '…' + rawText.slice(start, idx + keyword.length + 40).replace(/\s+/g, ' ').trim() + '…'
}

/** 對一段文字跑字典,回傳所有命中(每標籤一筆,取第一個命中的關鍵字為代表)。 */
export function detectOpportunities(rawText: string): SignalHit[] {
  const text = rawText || ''
  const nText = normalize(text)
  const hits: SignalHit[] = []
  for (const sig of SIGNAL_DICTIONARY) {
    const matched = sig.keywords.find((kw) => nText.includes(normalize(kw)))
    if (!matched) continue
    hits.push({
      tag: sig.tag,
      keyword: matched,
      evidence: extractEvidence(text, matched),
      implication: sig.implication,
      productLines: sig.productLines,
    })
  }
  return hits
}
