'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { OrderItem, ItemType } from '@/lib/orders-notion'
import type { PromotionItem } from '@/lib/promotion-items-notion'

interface ActivePromotion { id: string; name: string; type: string; startDate: string; endDate: string }

// Inline to avoid importing server-side Notion client in the browser bundle
const calcTotal = (items: OrderItem[]): number =>
  items.reduce((sum, it) => {
    if (it.itemType === 'gift' || it.itemType === 'sample') return sum
    return sum + it.quantity * (it.unitPrice || 0)
  }, 0)

const ITEM_TYPE_LABEL: Record<ItemType, string>  = { normal: '一般', gift: '贈品', sample: '樣品' }
const ITEM_TYPE_COLOR: Record<ItemType, string>  = {
  normal: 'bg-gray-100 text-gray-600',
  gift:   'bg-green-100 text-green-700',
  sample: 'bg-blue-100 text-blue-700',
}

// ── 產品目錄型別 (對應 /api/products/search + /api/products/families) ──

interface CatalogItem {
  id: string
  name: string
  manufacturer: string
  productType: string
  category: string
  skuCode: string
  price: number | null
  salePrice: number | null
  notes: string
}

interface FamilySpec {
  key: string
  label: string
  options: string[]
}

interface ProductFamily {
  id: string
  seriesCode: string
  seriesName: string
  brand: string
  productType: string
  category: string
  skuPattern?: string
  namePattern?: string
  specs: FamilySpec[]
  /** 規格選項不規則時，用查表取代 pattern 生成 SKU。key 格式：spec值以 "|" 串接 */
  skuMap?: Record<string, string>
  /** 特殊 UI 變體。'ymh-tooth-grid' = YAMAHACHI 牙型座標格 */
  uiVariant?: string
}

/** 從樣板字串與規格選擇建立貨品碼或品名 */
function buildFromPattern(pattern: string, selections: Record<string, string>): string {
  let result = pattern
  for (const [key, val] of Object.entries(selections)) {
    result = result.replace(`{${key}}`, val)
  }
  return result
}

// ── 狀態顏色 ──────────────────────────────────────────────────

const STATUS_OPTIONS = ['草稿', '已送出', '確認中', '已到貨', '已取消'] as const
type StatusType = typeof STATUS_OPTIONS[number]

const STATUS_COLOR: Record<StatusType, string> = {
  草稿:   'bg-gray-100 text-gray-600',
  已送出: 'bg-blue-100 text-blue-700',
  確認中: 'bg-yellow-100 text-yellow-700',
  已到貨: 'bg-green-100 text-green-700',
  已取消: 'bg-red-100 text-red-600',
}

// ── YMHToothGridPanel（YAMAHACHI 牙型座標格） ─────────────────

/** 判斷貨品碼中是否為「單顆位置」後綴
 *  前牙: C4-L1, C4-R2 → 後綴 /^[LR]\d+$/
 *  後牙: 28-LU4, 28-RL7 → 後綴 /^[LR][LU]\d+$/ */
function isSubPos(code: string): boolean {
  const parts = code.split('-')
  if (parts.length < 2) return false
  const last = parts[parts.length - 1]
  return /^[LR]\d+$/.test(last) || /^[LR][LU]\d+$/.test(last)
}

/** 牙形前綴 → 中文標籤 */
const TOOTH_FORM_LABEL: Record<string, string> = {
  C:  '組合形', S:  '方形',   SS: '短方形', T:  '尖形',
  TL: '長尖形', O:  '卵形',   LA: 'LA形',   LB: 'LB形',
  L:  'L形',    N:  'N形',    '': '基本',
}

/** 各前綴的排列優先順序（上顎 → 下顎） */
const PREFIX_ORDER = ['C','S','SS','T','TL','O','','LA','LB','L','N']

/** 從牙型碼清單建立「前綴 → [碼]」格線資料（排除單顆子位置） */
function buildToothGrid(moulds: string[]): { prefix: string; label: string; items: string[] }[] {
  const map = new Map<string, string[]>()
  for (const m of moulds) {
    if (isSubPos(m)) continue          // 跳過 C4-L1 等單顆子位置
    const pfx = m.match(/^([A-Z]*)(.+)$/)?.[1] ?? ''
    if (!map.has(pfx)) map.set(pfx, [])
    map.get(pfx)!.push(m)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      const ia = PREFIX_ORDER.indexOf(a), ib = PREFIX_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map(([prefix, items]) => ({
      prefix,
      label: TOOTH_FORM_LABEL[prefix] ?? prefix,
      items: items.sort((a, b) => {
        const na = parseFloat(a.replace(/^[A-Z]*/,'')), nb = parseFloat(b.replace(/^[A-Z]*/,''))
        return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b)
      }),
    }))
}

const SUBPOS_LABEL: Record<string, string> = {
  整排:'整排', L1:'左1', L2:'左2', L3:'左3', R1:'右1', R2:'右2', R3:'右3',
  // 後牙位置（臼齒）
  LL4:'左下4', LL5:'左下5', LL6:'左下6', LL7:'左下7',
  LU4:'左上4', LU5:'左上5', LU6:'左上6', LU7:'左上7',
  RL4:'右下4', RL5:'右下5', RL6:'右下6', RL7:'右下7',
  RU4:'右上4', RU5:'右上5', RU6:'右上6', RU7:'右上7',
}

// ── ToothArchDiagram (牙弓選位，前牙 / 後牙共用) ──────────────
// 前牙（anterior）: 左3 → 左1 ‖ 右1 → 右3（6顆）
// 後牙（posterior）: 左7 → 左4 ‖ 右4 → 右7（8顆）

const ARCH_TEETH = [
  { id: 'L3', w: 36, h: 44, label: '左3' },
  { id: 'L2', w: 33, h: 40, label: '左2' },
  { id: 'L1', w: 40, h: 49, label: '左1' },
  { id: 'R1', w: 40, h: 49, label: '右1' },
  { id: 'R2', w: 33, h: 40, label: '右2' },
  { id: 'R3', w: 36, h: 44, label: '右3' },
] as const

// 後牙牙弓（解剖比例：臼齒最寬最高，小臼齒較窄）
const POSTERIOR_ARCH_TEETH = [
  { id: 'L7', w: 48, h: 38, label: '左7' },
  { id: 'L6', w: 50, h: 42, label: '左6' },
  { id: 'L5', w: 38, h: 36, label: '左5' },
  { id: 'L4', w: 34, h: 33, label: '左4' },
  { id: 'R4', w: 34, h: 33, label: '右4' },
  { id: 'R5', w: 38, h: 36, label: '右5' },
  { id: 'R6', w: 50, h: 42, label: '右6' },
  { id: 'R7', w: 48, h: 38, label: '右7' },
] as const

function ToothArchDiagram({
  available,
  selected,
  onSelect,
  jaw,
  isPosterior = false,
}: {
  available: Set<string>
  selected: string
  onSelect: (pos: string) => void
  jaw: '上顎' | '下顎'
  isPosterior?: boolean
}) {
  const isUpper = jaw === '上顎'
  const BRAND   = '#b8956a'
  const GAP     = 3
  const PAD     = 12
  const LBL_H   = 14   // label area height
  const SVG_H   = 88

  // Calculate x positions
  const archDef = isPosterior ? POSTERIOR_ARCH_TEETH : ARCH_TEETH
  let cx = PAD
  const teeth = archDef.map((t) => {
    const x = cx; cx += t.w + GAP
    return { ...t, x }
  })
  const svgW = cx - GAP + PAD

  // Upper jaw: labels at top, teeth aligned at top y, gum below
  // Lower jaw: labels at bottom, teeth aligned at bottom y, gum above
  const toothTopY = LBL_H + 2                          // = 16 (upper jaw origin)
  const toothBotY = SVG_H - LBL_H - 4                  // = 70 (lower jaw bottom baseline)
  const labelY    = isUpper ? LBL_H - 3 : SVG_H - 3

  const getY = (h: number) => isUpper ? toothTopY : toothBotY - h

  // Gum line: connects the free (incisal) edges of all teeth
  const gumPts = teeth.map((t) => ({
    x: t.x + t.w / 2,
    y: isUpper ? toothTopY + t.h : toothBotY - t.h,
  }))
  const gumPath = gumPts.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`
    const prev = gumPts[i - 1]
    const cpx  = (prev.x + p.x) / 2
    return `${d} C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`
  }, '')

  return (
    <svg viewBox={`0 0 ${svgW} ${SVG_H}`} style={{ width: '100%', maxWidth: svgW }}>
      {/* Midline */}
      <line
        x1={svgW / 2} y1={isUpper ? LBL_H : 2}
        x2={svgW / 2} y2={isUpper ? SVG_H - 2 : SVG_H - LBL_H}
        stroke="#e5e7eb" strokeDasharray="3,3" strokeWidth={1}
      />

      {/* Gum contour */}
      <path
        d={gumPath} fill="none"
        stroke="#e8c4b8" strokeWidth={2} strokeLinecap="round" opacity={0.9}
      />

      {/* Teeth */}
      {teeth.map((t) => {
        const isAvail = available.has(t.id)
        const isSel   = selected === t.id
        const ty      = getY(t.h)
        const fill    = isSel ? BRAND   : isAvail ? '#ffffff' : '#f9fafb'
        const stroke  = isSel ? '#a07a52' : isAvail ? '#d1d5db' : '#e5e7eb'

        return (
          <g key={t.id}
            onClick={() => isAvail && onSelect(t.id)}
            style={{ cursor: isAvail ? 'pointer' : 'default' }}
          >
            <rect x={t.x} y={ty} width={t.w} height={t.h} rx={5}
              fill={fill} stroke={stroke} strokeWidth={isSel ? 2 : 1.5}
            />
            {/* Subtle surface highlight */}
            {isAvail && !isSel && (
              <rect
                x={t.x + 5} y={isUpper ? ty + 5 : ty + t.h - 8}
                width={t.w - 10} height={2.5} rx={1.2}
                fill="#eeeeee" opacity={0.7}
              />
            )}
            {/* Position label */}
            <text
              x={t.x + t.w / 2} y={labelY}
              textAnchor="middle" fontSize={9}
              fill={isSel ? BRAND : isAvail ? '#9ca3af' : '#d1d5db'}
              fontWeight={isSel ? '600' : '400'}
            >
              {t.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// 整排 vs 單顆包裝的顯示標籤
const QTY_LABEL: Record<string, string> = {
  '6顆':  '6顆 / 排（前牙整排）',
  '8顆':  '8顆 / 排（後牙整排）',
  '12顆': '12顆 / 盒（前牙單顆）',
  '20顆': '20顆 / 盒（後牙單顆）',
}
// 視為「整排」型的 qty key（非單顆）
const SET_QTY_KEYS = new Set(['6顆', '8顆'])

function YMHToothGridPanel({
  family,
  onAdd,
}: {
  family: ProductFamily
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
}) {
  const colorSpec = family.specs.find((s) => s.key === '顏色')
  const hasQty    = family.specs.some((s) => s.key === '數量')  // 目前僅 EFC-A

  const [color,  setColor]  = useState('')
  const [jaw,    setJaw]    = useState<'上顎'|'下顎'>('上顎')
  const [base,   setBase]   = useState('')
  const [qty,    setQty]    = useState('')
  const [subPos, setSubPos] = useState('')

  // 重置規則：往前改動會清掉後面的選擇
  const handleColor = (c: string) => { setColor(c); setBase(''); setQty(''); setSubPos('') }
  const handleJaw   = (j: string) => { setJaw(j as '上顎'|'下顎'); setBase(''); setQty(''); setSubPos('') }
  const handleBase  = (b: string) => { setBase(b === base ? '' : b); setSubPos('') }
  const handleQty   = (q: string) => { setQty(q); setSubPos('') }

  /** 目前顏色 + 上下顎下，可用的牙型座標（排除 L/R 子位置） */
  const baseMoulds = useMemo(() => {
    if (!family.skuMap || !color) return []
    const set = new Set<string>()
    Object.keys(family.skuMap).forEach((k) => {
      const parts = k.split('|')
      if (parts[0] === color && parts[1] === jaw) {
        const mould = parts[2]
        if (!isSubPos(mould)) set.add(mould)
      }
    })
    return Array.from(set)
  }, [family, color, jaw])

  const toothGrid = useMemo(() => buildToothGrid(baseMoulds), [baseMoulds])

  /** 選完 base 後，動態算出可用的包裝數量選項（含整排與單顆） */
  const availableQtys = useMemo(() => {
    if (!hasQty || !family.skuMap || !color || !base) return []
    const prefix = `${color}|${jaw}|${base}|`
    const qtys = new Set<string>()
    Object.keys(family.skuMap).forEach((k) => {
      if (k.startsWith(prefix)) qtys.add(k.slice(prefix.length).split('|')[0])
    })
    // 排序：整排類（6顆/8顆）排前面，單顆類（12顆/20顆）排後面
    return Array.from(qtys).sort((a, b) => {
      const aSet = SET_QTY_KEYS.has(a), bSet = SET_QTY_KEYS.has(b)
      if (aSet !== bSet) return aSet ? -1 : 1
      return parseInt(a) - parseInt(b)
    })
  }, [family, color, jaw, base, hasQty])

  const isSingleQty = !!qty && !SET_QTY_KEYS.has(qty)  // 12顆 / 20顆 = 單顆型

  /** 單顆子位置（選完 base + 單顆 qty 後，找 L1/L2/R1… 子位置） */
  const subPositions = useMemo(() => {
    if (!hasQty || !isSingleQty || !base || !color || !family.skuMap) return []
    const pfx = `${color}|${jaw}|`
    const subs: string[] = []
    if (family.skuMap[`${pfx}${base}|${qty}`]) subs.push('整排')
    Object.keys(family.skuMap)
      .filter((k) => k.startsWith(`${pfx}${base}-`) && k.endsWith(`|${qty}`))
      .forEach((k) => {
        const sub = k.split('|')[2].slice(base.length + 1)
        if (!subs.includes(sub)) subs.push(sub)
      })
    return subs
  }, [family, color, jaw, base, qty, hasQty, isSingleQty])

  // 後牙模式：subPositions 含有 LL/LU/RL/RU 開頭的位置碼
  const isPosterior = subPositions.some((p) => /^[LR][LU]\d+$/.test(p))

  // 後牙：將 LU4/LL4 等完整位置碼轉為牙弓圖中的顯示 ID（L4/R4）
  const posteriorToArchId = (pos: string) =>
    /^[LR][LU]\d+$/.test(pos) ? pos[0] + pos.slice(2) : pos
  // 後牙：從牙弓圖 ID（L4）+ 顎（上/下）還原位置碼（LU4/LL4）
  const archIdToPosteriorPos = (id: string, j: '上顎'|'下顎') =>
    /^[LR]\d+$/.test(id) && parseInt(id.slice(1)) >= 4
      ? id[0] + (j === '上顎' ? 'U' : 'L') + id.slice(1)
      : id

  /** 最終查 skuMap 的 key */
  const skuKey = useMemo(() => {
    if (!color || !base) return ''
    if (hasQty) {
      if (!qty) return ''
      if (!isSingleQty) return `${color}|${jaw}|${base}|${qty}`
      if (!subPos) return ''
      return subPos === '整排'
        ? `${color}|${jaw}|${base}|${qty}`
        : `${color}|${jaw}|${base}-${subPos}|${qty}`
    }
    return `${color}|${jaw}|${base}`
  }, [color, jaw, base, qty, subPos, hasQty, isSingleQty])

  const skuCode = skuKey && family.skuMap ? (family.skuMap[skuKey] ?? '') : ''
  const skuName = skuCode && family.namePattern
    ? buildFromPattern(family.namePattern, {
        顏色:  color,
        上下顎: jaw,
        牙型:  subPos && subPos !== '整排' ? `${base}-${subPos}` : base,
        數量:  hasQty ? qty : '',
      })
    : skuCode

  // 共用樣式工具
  const chip = (sel: boolean, disabled = false) => [
    'px-3 py-1 rounded-full text-xs font-medium border transition-all',
    disabled ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed' :
    sel       ? 'bg-brand-500 border-brand-500 text-white shadow-sm' :
                'bg-white border-gray-300 text-gray-700 hover:border-brand-400 hover:text-brand-600',
  ].join(' ')

  const tab = (sel: boolean) => [
    'px-5 py-1.5 rounded-lg text-sm font-medium border transition-all',
    sel ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
        : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
  ].join(' ')

  const toothBtn = (sel: boolean) => [
    'px-2.5 py-1 rounded text-xs font-mono font-medium border transition-all min-w-[2.5rem] text-center',
    sel ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
        : 'bg-white border-gray-300 text-gray-700 hover:border-brand-400 hover:bg-brand-50',
  ].join(' ')

  return (
    <div className="border-t border-gray-100 bg-stone-50 px-5 py-4 space-y-4">

      {/* ① 顏色 */}
      <div>
        <div className="text-xs font-semibold text-brand-600 mb-2">顏色 (Shade)</div>
        <div className="flex flex-wrap gap-1.5">
          {colorSpec?.options.map((c) => (
            <button key={c} onClick={() => handleColor(c)} className={chip(color === c)}>{c}</button>
          ))}
        </div>
      </div>

      {color && <>
        {/* ② 上下顎 */}
        <div>
          <div className="text-xs font-semibold text-brand-600 mb-2">上下顎</div>
          <div className="flex gap-2">
            {(['上顎','下顎'] as const).map((j) => (
              <button key={j} onClick={() => handleJaw(j)} className={tab(jaw === j)}>{j}</button>
            ))}
          </div>
        </div>

        {/* ③ 牙型座標格（前牙）或尺寸選擇（後牙） */}
        {toothGrid.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-brand-600 mb-2">
              {toothGrid.length === 1 && /^\d+$/.test(toothGrid[0].items[0]) ? '尺寸 (mm)' : '牙型座標'}
            </div>
            <div className="space-y-2">
              {toothGrid.map(({ prefix, label, items }) => (
                <div key={prefix} className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 w-14 text-right pt-1 shrink-0">{label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((item) => (
                      <button key={item} onClick={() => handleBase(item)} className={toothBtn(base === item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ④ 包裝數量（選完牙型後才出現；EFC-A 有整排 vs 單顆之分） */}
        {hasQty && base && availableQtys.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-brand-600 mb-2">包裝數量</div>
            <div className="flex flex-wrap gap-2">
              {availableQtys.map((q) => (
                <button key={q} onClick={() => handleQty(q)} className={chip(qty === q)}>
                  {QTY_LABEL[q] ?? q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ⑤ 牙弓示意圖（單顆型 qty + 已選 base + 有子位置） */}
        {hasQty && base && isSingleQty && subPositions.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-brand-600 mb-2.5">
              {base} · 選擇牙位
            </div>
            {/* 整排選項：12顆混合（不指定單顆位置） */}
            {subPositions.includes('整排') && (
              <div className="mb-3">
                <button
                  onClick={() => setSubPos(subPos === '整排' ? '' : '整排')}
                  className={chip(subPos === '整排')}
                >
                  整排（不指定牙位）
                </button>
              </div>
            )}
            {/* 牙弓 SVG：點選單顆位置 */}
            {subPositions.some((p) => p !== '整排') && (
              <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                <div className="text-[10px] text-gray-400 mb-1 text-center">
                  {isPosterior
                    ? (jaw === '上顎' ? '↑ 上顎臼齒（點選牙位 4–7）' : '↓ 下顎臼齒（點選牙位 4–7）')
                    : (jaw === '上顎' ? '↑ 上顎前牙（點選牙位）' : '↓ 下顎前牙（點選牙位）')}
                </div>
                <ToothArchDiagram
                  isPosterior={isPosterior}
                  available={new Set(
                    subPositions
                      .filter((p) => p !== '整排')
                      .map((p) => isPosterior ? posteriorToArchId(p) : p)
                  )}
                  selected={
                    subPos === '整排' ? '' :
                    isPosterior ? posteriorToArchId(subPos) : subPos
                  }
                  onSelect={(archId) => {
                    const pos = isPosterior ? archIdToPosteriorPos(archId, jaw) : archId
                    setSubPos(subPos === pos ? '' : pos)
                  }}
                  jaw={jaw}
                />
              </div>
            )}
          </div>
        )}
      </>}

      {/* 結果區 */}
      <div className="pt-1">
        {skuCode ? (
          <div className="flex items-center justify-between gap-3 bg-white rounded-lg border border-brand-200 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 leading-snug">{skuName}</div>
              <div className="text-xs text-gray-400 font-mono mt-0.5 truncate">{skuCode}</div>
            </div>
            <button
              onClick={() => {
                onAdd({ skuCode, skuName, brand: family.brand, seriesName: family.seriesName, seriesId: family.id, unitPrice: 0 })
                setBase(''); setSubPos(''); setQty('')
              }}
              className="shrink-0 bg-brand-500 text-white text-sm font-medium px-4 py-1.5 rounded-full hover:bg-brand-600 transition-colors"
            >
              + 加入
            </button>
          </div>
        ) : (
          <div className="text-xs text-gray-400">
            {!color                               ? '請選擇顏色' :
             !base                                ? '請在上方選擇尺寸或牙型座標' :
             hasQty && !qty                       ? '請選擇包裝數量' :
             hasQty && isSingleQty && !subPos     ? '請點選牙弓圖選擇牙位，或選「整排」' :
             ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ── FamilySpecPanel（按鈕式串聯規格選擇） ─────────────────────

function FamilySpecPanel({
  family,
  onAdd,
}: {
  family: ProductFamily
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
}) {
  const [selected, setSelected] = useState<Record<string, string>>({})

  /**
   * Compute which spec rows are visible and their valid options.
   * Supports "mixed-depth" families where some products need fewer spec levels
   * (e.g. a unified Detax family where Temp only needs 品項+顏色 but Crown needs 品項+顏色+容量,
   * and single-SKU products only need 品項).
   *
   * Supports "skip-level" mixed-depth families: if a spec level has no valid options
   * given the current visible prefix, that level is hidden but subsequent levels still
   * get a chance — each spec independently evaluates against the current visible prefix.
   * A level with no options is simply invisible; it does NOT cascade-hide later levels.
   * This allows e.g. 機型 → (材質 hidden for some machines) → 型號 to work correctly.
   */
  const specRows = useMemo(() => {
    type Row = { spec: typeof family.specs[0]; options: string[]; visible: boolean; specIdx: number }
    if (!family.skuMap) {
      return family.specs.map((spec, i) => ({ spec, options: spec.options, visible: true, specIdx: i }))
    }
    const keys = Object.keys(family.skuMap)
    const rows: Row[] = []

    for (let i = 0; i < family.specs.length; i++) {
      const spec = family.specs[i]

      if (i === 0) {
        const valid = new Set(keys.map((k) => k.split('|')[0]))
        rows.push({ spec, options: spec.options.filter((o) => valid.has(o)), visible: true, specIdx: i })
        continue
      }

      // Are all previous *visible* specs already selected?
      const prevVisibleAllSelected = rows.every((r) => !r.visible || !!selected[r.spec.key])

      if (!prevVisibleAllSelected) {
        // Not done yet → show with every option that appears at this depth anywhere
        const valid = new Set(keys.map((k) => k.split('|')[i]).filter(Boolean))
        rows.push({ spec, options: spec.options.filter((o) => valid.has(o)), visible: true, specIdx: i })
        continue
      }

      // Filter using the effective prefix built from *visible* selections only.
      // If this level has no valid options, hide it — but do NOT propagate a dead-end;
      // the next spec will re-evaluate with the same prefix (effectively skipping this level).
      const visibleSoFar = rows.filter((r) => r.visible)
      const prefix = visibleSoFar.map((r) => selected[r.spec.key]).join('|')
      const depth = visibleSoFar.length
      const valid = new Set(
        keys
          .filter((k) => k.startsWith(prefix + '|'))
          .map((k) => k.split('|')[depth])
          .filter(Boolean)
      )
      const opts = spec.options.filter((o) => valid.has(o))
      rows.push({ spec, options: opts, visible: opts.length > 0, specIdx: i })
    }
    return rows
  }, [family, selected])

  const visibleRows = specRows.filter((r) => r.visible)

  const handleChip = (specKey: string, specIdx: number, value: string) => {
    setSelected((prev) => {
      const next: Record<string, string> = {}
      // Keep selections from specs before this one
      family.specs.slice(0, specIdx).forEach((s) => {
        if (prev[s.key]) next[s.key] = prev[s.key]
      })
      // Toggle: click same value to deselect
      if (prev[specKey] !== value) next[specKey] = value
      return next
    })
  }

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => !!selected[r.spec.key])
  const skuKey = visibleRows.map((r) => selected[r.spec.key] ?? '').join('|')
  const skuCode = allSelected
    ? (family.skuMap ? (family.skuMap[skuKey] ?? '') : (family.skuPattern ? buildFromPattern(family.skuPattern, selected) : skuKey))
    : ''
  const skuName = allSelected
    ? (family.namePattern
        ? buildFromPattern(family.namePattern, selected)
        : visibleRows.map((r) => selected[r.spec.key]).filter(Boolean).join(' · '))
    : ''
  const isValid = allSelected && skuCode !== ''

  return (
    <div className="border-t border-gray-100 bg-stone-50 px-5 py-4 space-y-4">
      {visibleRows.map(({ spec, options, specIdx }, idx) => {
        const prevSelected = idx === 0 || !!selected[visibleRows[idx - 1].spec.key]
        return (
          <div key={spec.key}>
            <div className="text-xs font-semibold text-brand-600 mb-2">{spec.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {options.map((opt) => {
                const isSelected = selected[spec.key] === opt
                return (
                  <button
                    key={opt}
                    disabled={!prevSelected}
                    onClick={() => handleChip(spec.key, specIdx, opt)}
                    className={[
                      'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                      isSelected
                        ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                        : prevSelected
                          ? 'bg-white border-gray-300 text-gray-700 hover:border-brand-400 hover:text-brand-600'
                          : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed',
                    ].join(' ')}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 結果區 */}
      <div className="pt-1">
        {allSelected ? (
          isValid ? (
            <div className="flex items-center justify-between gap-3 bg-white rounded-lg border border-brand-200 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 leading-snug">{skuName}</div>
                <div className="text-xs text-gray-400 font-mono mt-0.5 truncate">{skuCode}</div>
              </div>
              <button
                onClick={() => {
                  onAdd({
                    skuCode,
                    skuName,
                    brand: family.brand,
                    seriesName: family.seriesName,
                    seriesId: family.id,
                    unitPrice: 0,
                  })
                  setSelected({})
                }}
                className="shrink-0 bg-brand-500 text-white text-sm font-medium px-4 py-1.5 rounded-full hover:bg-brand-600 transition-colors"
              >
                + 加入
              </button>
            </div>
          ) : (
            <div className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              此規格組合無對應貨品，請重新選擇
            </div>
          )
        ) : (
          <div className="text-xs text-gray-400">
            請選擇{family.specs.find((s) => !selected[s.key])?.label ?? ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ProductPicker ─────────────────────────────────────────────

function ProductPicker({
  onAdd,
  onClose,
}: {
  onAdd: (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterType, setFilterType] = useState('')
  const [families, setFamilies] = useState<ProductFamily[]>([])
  const [familiesLoading, setFamiliesLoading] = useState(true)
  const [allBrands, setAllBrands] = useState<string[]>([])
  const [allTypes, setAllTypes] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [browseItems, setBrowseItems] = useState<CatalogItem[]>([])
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 同時載入規格系列 + 完整目錄的篩選選項（44 品牌、7 類型）
  useEffect(() => {
    fetch('/api/products/families')
      .then((r) => r.json())
      .then((data) => { setFamilies(data); setFamiliesLoading(false) })
      .catch(() => setFamiliesLoading(false))

    fetch('/api/products/options')
      .then((r) => r.json())
      .then((data) => {
        if (data.brands) setAllBrands(data.brands)
        if (data.productTypes) setAllTypes(data.productTypes)
      })
      .catch(() => {})
  }, [])

  // 防抖搜尋：只有輸入文字關鍵字時才送 API（品牌 / 類型篩選由瀏覽模式 Accordion 處理）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const q = search.trim()
    if (!q) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '80' })
        params.set('q', q)
        if (filterBrand) params.set('brand', filterBrand)
        if (filterType) params.set('type', filterType)
        const res = await fetch(`/api/products/search?${params}`)
        if (res.ok) setSearchResults(await res.json())
      } catch { /* ignore */ } finally { setSearchLoading(false) }
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [search, filterBrand, filterType])

  const isSearching = search.trim().length > 0

  // 瀏覽模式：依品牌 / 類型篩選系列
  const filteredFamilies = useMemo(() => {
    if (!filterBrand && !filterType) return families
    return families.filter((f) => {
      if (filterBrand && f.brand !== filterBrand) return false
      if (filterType && f.productType !== filterType) return false
      return true
    })
  }, [families, filterBrand, filterType])

  // 搜尋模式：以關鍵字比對系列名稱 / 品牌 / 分類，同時套用 brand/type 篩選
  const familySearchResults = useMemo(() => {
    if (!search.trim()) return []
    const kw = search.trim().toLowerCase()
    return families.filter((f) => {
      if (filterBrand && f.brand !== filterBrand) return false
      if (filterType && f.productType !== filterType) return false
      return (
        f.seriesName.toLowerCase().includes(kw) ||
        f.brand.toLowerCase().includes(kw) ||
        f.category.toLowerCase().includes(kw) ||
        f.seriesCode.toLowerCase().includes(kw)
      )
    })
  }, [families, search, filterBrand, filterType])

  // 所有已被規格系列涵蓋的貨品碼（skuMap 中的 value），用於過濾搜尋結果
  const coveredSkuCodes = useMemo(() => {
    const s = new Set<string>()
    families.forEach((f) => {
      if (f.skuMap) Object.values(f.skuMap).forEach((code) => s.add(code))
    })
    return s
  }, [families])

  // 搜尋模式：去除已有規格系列涵蓋的品項，避免重複顯示
  const remainingSearchResults = useMemo(
    () => searchResults.filter((item) => !coveredSkuCodes.has(item.skuCode)),
    [searchResults, coveredSkuCodes]
  )

  // 瀏覽模式 fallback：當篩選條件有效但沒有符合的規格系列時，直接從目錄 API 拉個別品項
  useEffect(() => {
    if (isSearching) { setBrowseItems([]); return }
    if (!filterBrand && !filterType) { setBrowseItems([]); return }
    const params = new URLSearchParams({ limit: '200' })
    if (filterBrand) params.set('brand', filterBrand)
    if (filterType)  params.set('type', filterType)
    fetch(`/api/products/search?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((items: CatalogItem[]) => {
        setBrowseItems(items.filter((it) => !coveredSkuCodes.has(it.skuCode)))
      })
      .catch(() => setBrowseItems([]))
  }, [isSearching, filterBrand, filterType, coveredSkuCodes])

  const handleAddItem = useCallback(
    (item: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => onAdd(item),
    [onAdd]
  )

  const handleAddCatalogItem = useCallback(
    (item: CatalogItem) => {
      onAdd({
        skuCode:    item.skuCode,
        skuName:    item.name,
        brand:      item.manufacturer,
        seriesName: item.category,
        seriesId:   '',
        // 優先用促銷特價，fallback 到資料庫售價 → 定價 → 0
        unitPrice: item.salePrice ?? item.price ?? 0,
      })
    },
    [onAdd]
  )

  const toggleFamily = useCallback((id: string) => {
    setExpandedFamilyId((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '85vh' }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b rounded-t-2xl">
          <h2 className="text-base font-semibold text-gray-800">選擇品項</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 border-b space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpandedFamilyId(null) }}
            placeholder="搜尋全部 6,037 筆商品（品名 / 貨品碼）..."
            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
          <div className="flex gap-2">
            <select
              value={filterBrand}
              onChange={(e) => { setFilterBrand(e.target.value); setExpandedFamilyId(null) }}
              className="flex-1 border rounded px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="">全部品牌</option>
              {allBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setExpandedFamilyId(null) }}
              className="flex-1 border rounded px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="">全部類型</option>
              {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isSearching ? (
            /* ── 搜尋模式：規格系列優先，再顯示其餘個別品項 ── */
            searchLoading ? (
              <div className="text-center text-gray-400 py-12 text-sm animate-pulse">搜尋中...</div>
            ) : familySearchResults.length === 0 && remainingSearchResults.length === 0 ? (
              <div className="text-center text-gray-400 py-12 text-sm">無符合品項</div>
            ) : (
              <div className="divide-y">
                {/* ① 符合的規格系列 */}
                {familySearchResults.map((family) => {
                  const isExpanded = expandedFamilyId === family.id
                  return (
                    <div key={family.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                        onClick={() => toggleFamily(family.id)}
                      >
                        <span className="text-gray-400 text-xs w-4 shrink-0">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{family.seriesName}</div>
                          <div className="text-xs text-gray-400 flex flex-wrap gap-1.5">
                            <span>{family.brand}</span>
                            <span>·</span>
                            <span>{family.productType}</span>
                            {family.specs.length > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-brand-500">
                                  {family.specs.map((s) => s.label).join(' × ')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        family.uiVariant === 'ymh-tooth-grid'
                          ? <YMHToothGridPanel family={family} onAdd={handleAddItem} />
                          : <FamilySpecPanel   family={family} onAdd={handleAddItem} />
                      )}
                    </div>
                  )
                })}
                {/* ② 其餘不屬於任何規格系列的個別品項 */}
                {remainingSearchResults.length > 0 && (
                  <>
                    {familySearchResults.length > 0 && (
                      <div className="px-4 py-2 bg-gray-50 border-y border-gray-100 text-xs text-gray-500 font-medium">
                        其他品項
                      </div>
                    )}
                    {remainingSearchResults.map((item) => (
                      <div
                        key={item.skuCode}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                          <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                            <span className="font-mono">{item.skuCode}</span>
                            <span>{item.manufacturer} · {item.category}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddCatalogItem(item)}
                          className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
                        >
                          + 加入
                        </button>
                      </div>
                    ))}
                    {remainingSearchResults.length >= 80 && (
                      <div className="text-center text-xs text-gray-400 py-3 bg-gray-50">
                        顯示前 80 筆，請輸入更精確的關鍵字
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          ) : (
            /* ── 瀏覽模式：規格系列 Accordion ── */
            familiesLoading ? (
              <div className="text-center text-gray-400 py-12 text-sm animate-pulse">載入中...</div>
            ) : filteredFamilies.length === 0 ? (
              browseItems.length > 0 ? (
                <div className="divide-y">
                  {browseItems.map((item) => (
                    <div key={item.skuCode} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                        <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                          <span className="font-mono">{item.skuCode}</span>
                          <span>{item.manufacturer} · {item.category}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAddCatalogItem(item)}
                        className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
                      >
                        + 加入
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-12 text-sm">沒有符合條件的品項</div>
              )
            ) : (
              <div className="divide-y">
                {filteredFamilies.map((family) => {
                  const isExpanded = expandedFamilyId === family.id
                  return (
                    <div key={family.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                        onClick={() => toggleFamily(family.id)}
                      >
                        <span className="text-gray-400 text-xs w-4 shrink-0">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{family.seriesName}</div>
                          <div className="text-xs text-gray-400 flex flex-wrap gap-1.5">
                            <span>{family.brand}</span>
                            <span>·</span>
                            <span>{family.productType}</span>
                            {family.specs.length > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-brand-500">
                                  {family.specs.map((s) => s.label).join(' × ')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        family.uiVariant === 'ymh-tooth-grid'
                          ? <YMHToothGridPanel family={family} onAdd={handleAddItem} />
                          : <FamilySpecPanel   family={family} onAdd={handleAddItem} />
                      )}
                    </div>
                  )
                })}
                {/* 篩選模式下，屬於該品牌/類型但不在規格系列中的個別品項 */}
                {browseItems.length > 0 && (
                  <>
                    <div className="px-4 py-2 bg-gray-50 border-y border-gray-100 text-xs text-gray-500 font-medium">
                      其他品項
                    </div>
                    {browseItems.map((item) => (
                      <div key={item.skuCode} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{item.name}</div>
                          <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                            <span className="font-mono">{item.skuCode}</span>
                            <span>{item.manufacturer} · {item.category}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddCatalogItem(item)}
                          className="shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium px-2.5 py-1 hover:bg-blue-100 rounded transition-colors"
                        >
                          + 加入
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {/* 提示：規格系列以外的品項請搜尋 */}
                {!filterBrand && !filterType && (
                <div className="px-4 py-3 bg-blue-50/60 border-t border-blue-100">
                  <p className="text-xs text-blue-600 leading-relaxed">
                    💡 以上為含規格選項的系列。其餘 <span className="font-semibold">6,037 筆</span> 商品請在上方搜尋欄輸入品名或貨品碼，或選擇品牌 / 類型篩選。
                  </p>
                </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t rounded-b-2xl text-xs text-gray-400 text-center bg-gray-50">
          {isSearching
            ? `${familySearchResults.length} 個系列・${remainingSearchResults.length} 筆其他品項`
            : browseItems.length > 0
              ? `${filteredFamilies.length} 個規格系列・${browseItems.length} 筆其他品項`
              : `${filteredFamilies.length} 個規格系列 · 搜尋可找到全部 6,037 筆`}
        </div>
      </motion.div>
    </div>
  )
}

// ── CustomerSearchBox ─────────────────────────────────────────
// 單一文字欄位：直接打字即為客戶名稱；同時即時搜尋 CRM，選取後自動填入其他欄位

interface CustomerResult {
  id: string
  name: string
  city: string
  address: string
}

interface SelectedCustomer {
  id: string
  name: string
  companyTitle: string
  address: string
  phone: string
  contactPerson: string
  taxId: string
}

function CustomerNameInput({
  customer,
  onChange,
  disabled,
}: {
  customer: SelectedCustomer
  onChange: (c: SelectedCustomer) => void
  disabled?: boolean
}) {
  const [results, setResults] = useState<CustomerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const timerRef = useState<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useState<HTMLDivElement | null>(null)

  // Debounced CRM search
  const handleNameChange = (val: string) => {
    onChange({ ...customer, name: val, id: '' })
    if (timerRef[0]) clearTimeout(timerRef[0])
    if (!val.trim()) { setResults([]); setOpen(false); return }
    timerRef[0] = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(val)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data)
          setOpen(data.length > 0)
        }
      } catch { /* ignore */ } finally { setSearching(false) }
    }, 300)
  }

  // Click-outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef[0] && !wrapRef[0].contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapRef[0]])

  const handleSelect = async (c: CustomerResult) => {
    setOpen(false)
    setResults([])
    try {
      const res = await fetch(`/api/customers/${c.id}`)
      if (res.ok) {
        const data = await res.json()
        const d = data.customer
        onChange({
          id: c.id,
          name: d?.name ?? c.name,
          companyTitle: customer.companyTitle,
          address: d?.address ?? c.address,
          phone: d?.phone ?? '',
          contactPerson: customer.contactPerson,
          taxId: d?.taxId ?? '',
        })
        return
      }
    } catch { /* fallback */ }
    onChange({ ...customer, id: c.id, name: c.name, address: c.address })
  }

  return (
    <div className="relative" ref={(el) => { wrapRef[0] = el }}>
      <div className="relative">
        <input
          type="text"
          value={customer.name}
          onChange={(e) => handleNameChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="輸入客戶 / 診所名稱（可直接填寫，或由 CRM 選取）"
          disabled={disabled}
          className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500 pr-16"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 animate-pulse">搜尋中…</span>
        )}
        {!searching && customer.id && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-500">✓ 已連結</span>
        )}
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border rounded-xl shadow-xl overflow-hidden"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {results.map((c) => (
              <button
                key={c.id}
                onMouseDown={() => handleSelect(c)}
                className="w-full text-left px-4 py-2.5 hover:bg-brand-50 border-b last:border-0 transition-colors"
              >
                <div className="text-sm font-medium text-stone-800">{c.name}</div>
                {(c.city || c.address) && (
                  <div className="text-xs text-stone-400 mt-0.5">{c.city}{c.address ? ` · ${c.address}` : ''}</div>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Promotion condition helpers ───────────────────────────────

/**
 * 計算買N送M的贈品數量（可重複觸發）
 * 買10送2（買5送1）→ floor(10/5)*1 = 2
 */
function calcBuyNGetMGiftQty(orderQty: number, n: number, m: number): number {
  return Math.floor(orderQty / n) * m
}

/**
 * 對新加入的品項套用促銷條件，回傳：
 * - patches:   直接修改 newItem 的欄位（自動）
 * - giftRows:  需要額外插入的贈品列（buy_a_get_b）
 * - hintLabel: 顯示在品項列上的提示文字（半自動 / 資訊型）
 */
function applyPromoCondition(newItem: OrderItem, promoItem: PromotionItem): {
  patches:   Partial<OrderItem>
  giftRows:  OrderItem[]
  hintLabel: string | null
} {
  const p = promoItem.conditionParams as any
  const patches:  Partial<OrderItem> = {}
  const giftRows: OrderItem[]        = []
  let   hintLabel: string | null     = null

  switch (promoItem.conditionType) {

    // ── 全自動：直接帶價 ──────────────────────────────────────
    case 'single_price':
      if (p?.price != null) {
        patches.unitPrice = p.price
        hintLabel = `促銷價 NT$${Number(p.price).toLocaleString()}`
      }
      break

    case 'add_on':
      if (p?.addOnPrice != null) {
        patches.unitPrice = p.addOnPrice
        hintLabel = `加購價 NT$${Number(p.addOnPrice).toLocaleString()}`
      }
      break

    case 'fixed_set_price': {
      // 初次加入（qty=1）先找是否剛好有 1件 tier；之後靠 handleQtyChange 更新
      const tier = (p?.tiers ?? []).find((t: any) => t.qty === 1)
      if (tier) patches.unitPrice = Math.round(tier.totalPrice / tier.qty)
      // 顯示全部方案供業務參考
      if ((p?.tiers ?? []).length > 0) {
        hintLabel = (p.tiers as { qty: number; totalPrice: number }[])
          .map((t) => `${t.qty}件 NT$${t.totalPrice.toLocaleString()}`)
          .join(' / ')
      }
      break
    }

    // ── 自動插入贈品列 ────────────────────────────────────────
    case 'buy_a_get_b':
      if (p?.giftSkuCode) {
        giftRows.push({
          id:         `gift-${Date.now()}-${Math.random()}`,
          skuCode:    p.giftSkuCode,
          skuName:    p.giftSkuName ?? p.giftSkuCode,
          brand:      '',
          seriesName: '',
          seriesId:   '',
          quantity:   p.giftQty ?? 1,
          unitPrice:  0,
          itemType:   'gift',
          note:       '[促銷贈品]',
        } as OrderItem)
        hintLabel = `買→贈 ${p.giftSkuName ?? p.giftSkuCode}`
      }
      break

    // ── 半自動：顯示提示，數量聯動由 handleQtyChange 接手 ───
    case 'buy_n_get_m':
      if (p?.n && p?.m) hintLabel = `買${p.n}送${p.m}（數量足時自動補贈品）`
      break

    case 'series_discount':
      if (p?.rate != null) hintLabel = `全系列 ${Math.round(p.rate * 10)}折`
      break

    case 'qty_discount':
      if ((p?.tiers ?? []).length > 0) {
        hintLabel = (p.tiers as { minQty: number; rate?: number; price?: number }[])
          .map((t) => `滿${t.minQty}件 ${t.rate != null ? Math.round(t.rate * 10) + '折' : 'NT$' + t.price}`)
          .join(' / ')
      }
      break

    case 'bundle':
      hintLabel = p?.partnerSkuName ? `搭配 ${p.partnerSkuName} 可享組合優惠` : '商品組合優惠'
      break

  }

  return { patches, giftRows, hintLabel }
}

// ── OrderForm (主元件) ────────────────────────────────────────

interface OrderFormProps {
  initialOrder?: {
    id: string
    orderNumber: string
    date: string
    salesperson: string
    status: string
    note: string
    items: OrderItem[]
    customerId?: string
    customerName?: string
    companyTitle?: string
    customerAddress?: string
    customerPhone?: string
    contactPerson?: string
    customerTaxId?: string
    promotionId?:   string
    promotionName?: string
  }
  canEdit?: boolean
}

export default function OrderForm({ initialOrder, canEdit = true }: OrderFormProps) {
  const router = useRouter()
  const isEdit = !!initialOrder

  // Form state
  // 日期初始值在 useEffect 設定，避免 Server/Client 時間不同導致 Hydration Mismatch
  const [date, setDate] = useState(initialOrder?.date ?? '')
  useEffect(() => {
    if (!date) {
      setDate(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [salesperson, setSalesperson] = useState(initialOrder?.salesperson ?? '')
  const [salespersonOptions, setSalespersonOptions] = useState<string[]>([])
  const [note, setNote] = useState(initialOrder?.note ?? '')
  const [status, setStatus] = useState<string>(initialOrder?.status ?? '草稿')
  const [items, setItems] = useState<OrderItem[]>(initialOrder?.items ?? [])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Promotion
  const [promotionId,   setPromotionId]   = useState(initialOrder?.promotionId   ?? '')
  const [promotionName, setPromotionName] = useState(initialOrder?.promotionName ?? '')
  const [activePromos,  setActivePromos]  = useState<ActivePromotion[]>([])
  // 已確認的促銷品項（促銷選定後載入）
  const [promoItems,    setPromoItems]    = useState<PromotionItem[]>([])
  // 追蹤 buy_n_get_m 的贈品列：mainItemId → giftItemId
  const [giftLinkMap,   setGiftLinkMap]   = useState<Record<string, string>>({})
  // 促銷提示文字：itemId → label
  const [promoHints,    setPromoHints]    = useState<Record<string, string>>({})

  // 客戶資訊
  const [customer, setCustomer] = useState<SelectedCustomer>({
    id: initialOrder?.customerId ?? '',
    name: initialOrder?.customerName ?? '',
    companyTitle: initialOrder?.companyTitle ?? '',
    address: initialOrder?.customerAddress ?? '',
    phone: initialOrder?.customerPhone ?? '',
    contactPerson: initialOrder?.contactPerson ?? '',
    taxId: initialOrder?.customerTaxId ?? '',
  })

  // Load salesperson options
  useEffect(() => {
    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.salespersons)) setSalespersonOptions(data.salespersons) })
      .catch(() => {})
  }, [])

  // Load active promotions for the dropdown
  useEffect(() => {
    fetch('/api/promotions?active=1')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setActivePromos(data) })
      .catch(() => {})
  }, [])

  // 促銷選定後，載入該活動已確認的品項條件
  useEffect(() => {
    if (!promotionId) {
      setPromoItems([])
      setGiftLinkMap({})
      setPromoHints({})
      return
    }
    fetch(`/api/promotions/${promotionId}/items`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setPromoItems((data as PromotionItem[]).filter((i) => i.status === '已確認'))
        }
      })
      .catch(() => {})
  }, [promotionId])

  // Add item from picker — with promotion logic
  const handleAddItem = useCallback(
    (partial: Omit<OrderItem, 'id' | 'quantity' | 'note'>) => {
      // 已存在：只加數量（buy_n_get_m 的贈品更新由 handleQtyChange 接手）
      const existingItem = items.find((it) => it.skuCode === partial.skuCode)
      if (existingItem) {
        setItems((prev) =>
          prev.map((it) =>
            it.skuCode === partial.skuCode ? { ...it, quantity: it.quantity + 1 } : it
          )
        )
        return
      }

      // 新品項（unitPrice 來自 partial：salePrice → price → 0；促銷條件之後再覆蓋）
      const newItem: OrderItem = {
        ...partial,
        id:       `item-${Date.now()}-${Math.random()}`,
        quantity: 1,
        note:     '',
        // 保留 partial.unitPrice（資料庫定價），不強制蓋 0
        unitPrice: partial.unitPrice ?? 0,
      }

      // 找對應的已確認促銷品項
      // 優先精確 SKU 比對；找不到時以系列 ID 比對（系列層級品項）
      const promoItem =
        promoItems.find((p) => p.skuCode && p.skuCode === partial.skuCode) ??
        (partial.seriesId
          ? promoItems.find((p) => p.seriesId && p.seriesId === partial.seriesId)
          : undefined)

      if (!promoItem?.conditionType) {
        setItems((prev) => [...prev, newItem])
        return
      }

      const { patches, giftRows, hintLabel } = applyPromoCondition(newItem, promoItem)
      const finalItem = { ...newItem, ...patches }

      // buy_n_get_m：qty=1 時通常不夠 n，但若剛好夠就先插贈品
      const extraGiftRows: OrderItem[] = [...giftRows]
      const newGiftLinks: Record<string, string> = {}

      if (promoItem.conditionType === 'buy_n_get_m') {
        const p = promoItem.conditionParams as any
        if (p?.n && p?.m) {
          const giftQty = calcBuyNGetMGiftQty(1, p.n, p.m)
          if (giftQty > 0) {
            const giftId = `gift-${Date.now()}-${Math.random()}`
            extraGiftRows.push({
              id: giftId, skuCode: finalItem.skuCode, skuName: finalItem.skuName,
              brand: finalItem.brand, seriesName: finalItem.seriesName ?? '',
              seriesId: finalItem.seriesId ?? '',
              quantity: giftQty, unitPrice: 0, itemType: 'gift',
              note: `[促銷贈品] 買${p.n}送${p.m}`,
            } as OrderItem)
            newGiftLinks[finalItem.id] = giftId
          }
        }
      }

      setItems((prev) => [...prev, finalItem, ...extraGiftRows])
      if (Object.keys(newGiftLinks).length > 0)
        setGiftLinkMap((lm) => ({ ...lm, ...newGiftLinks }))
      if (hintLabel)
        setPromoHints((h) => ({ ...h, [finalItem.id]: hintLabel }))
    },
    [items, promoItems]
  )

  const updateItem = useCallback(
    (id: string, changes: Partial<OrderItem>) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, ...changes } : it))
      )
    },
    []
  )

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    // 若刪除的是主商品，也刪除對應贈品列
    setGiftLinkMap((lm) => {
      const giftId = lm[id]
      if (!giftId) return lm
      setItems((prev) => prev.filter((it) => it.id !== giftId))
      const next = { ...lm }; delete next[id]; return next
    })
    setPromoHints((h) => { const next = { ...h }; delete next[id]; return next })
  }, [])

  // 數量變更：聯動 buy_n_get_m 贈品 & fixed_set_price 帶價
  const handleQtyChange = useCallback(
    (item: OrderItem, newQty: number) => {
      updateItem(item.id, { quantity: newQty })

      const promoItem =
        promoItems.find((p) => p.skuCode && p.skuCode === item.skuCode) ??
        (item.seriesId ? promoItems.find((p) => p.seriesId && p.seriesId === item.seriesId) : undefined)
      if (!promoItem?.conditionType || !promoItem.conditionParams) return

      const p = promoItem.conditionParams as any

      if (promoItem.conditionType === 'buy_n_get_m' && p?.n && p?.m) {
        const giftQty      = calcBuyNGetMGiftQty(newQty, p.n, p.m)
        const existGiftId  = giftLinkMap[item.id]

        if (giftQty <= 0 && existGiftId) {
          // 不夠 n 件：移除贈品列
          setItems((prev) => prev.filter((it) => it.id !== existGiftId))
          setGiftLinkMap((lm) => { const next = { ...lm }; delete next[item.id]; return next })
        } else if (giftQty > 0 && existGiftId) {
          // 更新贈品數量
          updateItem(existGiftId, { quantity: giftQty })
        } else if (giftQty > 0 && !existGiftId) {
          // 新增贈品列
          const giftId = `gift-${Date.now()}-${Math.random()}`
          const giftRow = {
            id: giftId, skuCode: item.skuCode, skuName: item.skuName,
            brand: item.brand, seriesName: item.seriesName ?? '', seriesId: item.seriesId ?? '',
            quantity: giftQty, unitPrice: 0, itemType: 'gift' as ItemType,
            note: `[促銷贈品] 買${p.n}送${p.m}`,
          } as OrderItem
          setItems((prev) => [...prev, giftRow])
          setGiftLinkMap((lm) => ({ ...lm, [item.id]: giftId }))
        }
      }

      if (promoItem.conditionType === 'fixed_set_price' && (p?.tiers ?? []).length > 0) {
        // 找最接近且 >= newQty 的 tier（或精確匹配）
        const exact = (p.tiers as { qty: number; totalPrice: number }[]).find((t) => t.qty === newQty)
        if (exact) {
          updateItem(item.id, { unitPrice: Math.round(exact.totalPrice / exact.qty) })
        }
      }

      if (promoItem.conditionType === 'qty_discount' && (p?.tiers ?? []).length > 0) {
        // 找最高滿足的 tier
        const applicable = (p.tiers as { minQty: number; rate?: number; price?: number }[])
          .filter((t) => newQty >= t.minQty)
          .sort((a, b) => b.minQty - a.minQty)[0]
        if (applicable?.price != null) {
          updateItem(item.id, { unitPrice: applicable.price })
        }
        // rate 型（series_discount）需要原價，暫不自動帶；提示已顯示
      }
    },
    [promoItems, giftLinkMap, updateItem]
  )

  // Save
  const handleSave = async (targetStatus: string) => {
    if (!salesperson.trim()) {
      setError('請填寫業務姓名')
      return
    }
    if (items.length === 0) {
      setError('請至少新增一個品項')
      return
    }
    setError('')
    setSaving(true)

    try {
      const customerPayload = {
        customerId: customer.id,
        customerName: customer.name,
        companyTitle: customer.companyTitle,
        customerAddress: customer.address,
        customerPhone: customer.phone,
        contactPerson: customer.contactPerson,
        customerTaxId: customer.taxId,
      }
      const body = JSON.stringify({ date, salesperson, note, items, status: targetStatus, ...customerPayload, promotionId, promotionName })
      const res = isEdit && initialOrder
        ? await fetch(`/api/orders/${initialOrder.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
          })
        : await fetch('/api/orders', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `伺服器錯誤 (${res.status})`)
      }

      router.push('/orders')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  // Print
  const handlePrint = () => {
    const html = buildPrintHtml({ orderNumber: initialOrder?.orderNumber ?? '草稿', date, salesperson, note, status, items, customer })
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (doc) { doc.open(); doc.write(html); doc.close() }
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 2000)
    }, 500)
  }

  const totalQty = items.reduce((acc, it) => acc + it.quantity, 0)
  const totalAmount = calcTotal(items)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header info */}
      <div className="bg-white border rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          {isEdit && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">訂單編號</label>
              <span className="font-mono text-sm font-semibold text-gray-700">{initialOrder?.orderNumber}</span>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">訂貨日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm w-[8.5rem] focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">業務姓名 *</label>
            {salespersonOptions.length > 0 ? (
              <select
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
              >
                <option value="">請選擇</option>
                {salespersonOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                placeholder="輸入姓名"
                className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
              />
            )}
          </div>
          {isEdit && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">狀態</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex-1 min-w-0 w-full sm:w-auto">
            <label className="block text-xs text-gray-500 mb-1">備註</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="訂單備註（選填）"
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* Promotion selector */}
          <div className="w-full sm:w-auto">
            <label className="block text-xs text-gray-500 mb-1">關聯促銷活動</label>
            <select
              value={promotionId}
              onChange={(e) => {
                const id = e.target.value
                const promo = activePromos.find((p) => p.id === id)
                setPromotionId(id)
                setPromotionName(promo?.name ?? '')
              }}
              disabled={!canEdit}
              className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 max-w-[220px]"
            >
              <option value="">— 無關聯活動 —</option>
              {activePromos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {/* If the order already has a promotion that's now ended, still show it */}
              {promotionId && !activePromos.find((p) => p.id === promotionId) && (
                <option value={promotionId}>{promotionName}</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* 客戶資訊 */}
      <div className="bg-white border rounded-lg p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">客戶資訊</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 客戶名稱：單一欄位，打字即搜尋 CRM */}
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">客戶名稱</label>
            <CustomerNameInput customer={customer} onChange={setCustomer} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">聯絡人</label>
            <input
              type="text"
              value={customer.contactPerson}
              onChange={(e) => setCustomer((c) => ({ ...c, contactPerson: e.target.value }))}
              placeholder="聯絡人姓名（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">電話</label>
            <input
              type="text"
              value={customer.phone}
              onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
              placeholder="電話號碼（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">統一編號</label>
            <input
              type="text"
              value={customer.taxId}
              onChange={(e) => setCustomer((c) => ({ ...c, taxId: e.target.value }))}
              placeholder="統一編號（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              公司抬頭 <span className="text-gray-400 text-[10px]">（選填）</span>
            </label>
            <input
              type="text"
              value={customer.companyTitle}
              onChange={(e) => setCustomer((c) => ({ ...c, companyTitle: e.target.value }))}
              placeholder="如：XX 牙醫診所"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">地址</label>
            <input
              type="text"
              value={customer.address}
              onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))}
              placeholder="送貨地址（選填）"
              disabled={!canEdit}
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-gray-800 min-w-0">
            訂貨品項
            {items.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400 whitespace-nowrap">
                {items.length} 種 · 共 {totalQty} 件
              </span>
            )}
          </h2>
          {canEdit && (
          <button
            onClick={() => setShowPicker(true)}
            className="button-primary px-4 py-1.5 text-sm rounded shrink-0 whitespace-nowrap"
          >
            + 新增品項
          </button>
        )}
        </div>

        {items.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <div className="text-3xl mb-2">📦</div>
            <div className="text-sm">尚未新增品項，點擊「新增品項」開始選擇</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left w-8">#</th>
                  <th className="px-3 py-2.5 text-left">貨品碼</th>
                  <th className="px-3 py-2.5 text-left">品牌</th>
                  <th className="px-3 py-2.5 text-left">品名</th>
                  <th className="px-3 py-2.5 text-center w-20">類型</th>
                  <th className="px-3 py-2.5 text-center w-24">數量</th>
                  <th className="px-3 py-2.5 text-right w-28">單價</th>
                  <th className="px-3 py-2.5 text-right w-28">金額</th>
                  <th className="px-3 py-2.5 text-left">備註</th>
                  <th className="px-3 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, idx) => {
                  const type     = (item.itemType ?? 'normal') as ItemType
                  const isGift   = type === 'gift' || type === 'sample'
                  const qty      = Math.max(1, item.quantity || 1)
                  const price    = isGift ? 0 : (item.unitPrice || 0)
                  const lineAmt  = qty * price
                  return (
                    <tr key={item.id} className={isGift ? 'bg-green-50/40 hover:bg-green-50' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{item.skuCode}</td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{item.brand}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-800">{item.skuName}</div>
                        {/* 促銷提示 badge */}
                        {promoHints[item.id] && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            <span>⚡</span>
                            <span>{promoHints[item.id]}</span>
                          </div>
                        )}
                      </td>

                      {/* 類型 */}
                      <td className="px-3 py-2.5 text-center">
                        <select
                          value={type}
                          onChange={(e) => {
                            const next = e.target.value as ItemType
                            updateItem(item.id, {
                              itemType:  next,
                              unitPrice: next === 'gift' || next === 'sample' ? 0 : item.unitPrice,
                            })
                          }}
                          disabled={!canEdit}
                          className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-300 ${ITEM_TYPE_COLOR[type]}`}
                        >
                          <option value="normal">一般</option>
                          <option value="gift">贈品</option>
                          <option value="sample">樣品</option>
                        </select>
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => {
                              if (!isGift) handleQtyChange(item, Math.max(1, qty - 1))
                              else updateItem(item.id, { quantity: Math.max(1, qty - 1) })
                            }}
                            className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                          >−</button>
                          <input
                            type="number"
                            min={1}
                            value={qty}
                            onChange={(e) => {
                              const v = Math.max(1, parseInt(e.target.value) || 1)
                              if (!isGift) handleQtyChange(item, v)
                              else updateItem(item.id, { quantity: v })
                            }}
                            className="w-12 text-center border rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <button
                            onClick={() => {
                              if (!isGift) handleQtyChange(item, qty + 1)
                              else updateItem(item.id, { quantity: qty + 1 })
                            }}
                            className="w-6 h-6 rounded border text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm leading-none"
                          >+</button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {isGift ? (
                          <span className="block text-right text-sm text-green-600 font-medium">$0</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={price > 0 ? price : ''}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value)
                              updateItem(item.id, { unitPrice: isFinite(v) && v >= 0 ? v : 0 })
                            }}
                            placeholder="—"
                            className="w-full text-right border-0 border-b border-dashed border-gray-300 text-sm focus:outline-none focus:border-blue-400 bg-transparent"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm text-gray-700 tabular-nums">
                        {isGift
                          ? <span className="text-green-500 text-xs">贈送</span>
                          : price > 0
                            ? lineAmt.toLocaleString()
                            : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={item.note ?? ''}
                          onChange={(e) => updateItem(item.id, { note: e.target.value })}
                          placeholder="備註"
                          className="w-full border-0 border-b border-dashed border-gray-300 text-sm focus:outline-none focus:border-blue-400 bg-transparent"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-300 hover:text-red-400 text-lg leading-none"
                        >×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot style={{ display: totalAmount > 0 ? '' : 'none' }}>
                <tr className="border-t-2 bg-gray-50">
                  <td colSpan={7} className="px-3 py-2.5 text-right text-sm font-medium text-gray-600">合計（不含贈品）</td>
                  <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-800 tabular-nums">
                    {totalAmount > 0 ? totalAmount.toLocaleString() : ''}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 訂購統計 */}
      {items.length > 0 && (
        <div className="bg-white border rounded-lg p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3">訂購統計</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="text-left pb-2 font-medium">品牌</th>
                  <th className="text-center pb-2 font-medium">種類</th>
                  <th className="text-center pb-2 font-medium">件數</th>
                  {totalAmount > 0 && <th className="text-right pb-2 font-medium">小計</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {Object.entries(
                  items.reduce((acc, it) => {
                    if (!acc[it.brand]) acc[it.brand] = { kinds: 0, qty: 0, amt: 0 }
                    acc[it.brand].kinds += 1
                    acc[it.brand].qty += it.quantity
                    acc[it.brand].amt += it.quantity * (it.unitPrice || 0)
                    return acc
                  }, {} as Record<string, { kinds: number; qty: number; amt: number }>)
                )
                  .sort((a, b) => b[1].qty - a[1].qty)
                  .map(([brand, stat]) => (
                    <tr key={brand} className="text-gray-700">
                      <td className="py-1.5">{brand || '—'}</td>
                      <td className="text-center py-1.5 tabular-nums">{stat.kinds} 種</td>
                      <td className="text-center py-1.5 tabular-nums font-medium">{stat.qty} 件</td>
                      {totalAmount > 0 && (
                        <td className="text-right py-1.5 tabular-nums text-gray-500">
                          {stat.amt > 0 ? stat.amt.toLocaleString() : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold text-gray-800">
                  <td className="pt-2">合計</td>
                  <td className="text-center pt-2 tabular-nums">{items.length} 種</td>
                  <td className="text-center pt-2 tabular-nums">{totalQty} 件</td>
                  {totalAmount > 0 && (
                    <td className="text-right pt-2 tabular-nums">NT$ {totalAmount.toLocaleString()}</td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => router.back()}
            className="button-secondary px-4 py-2 text-sm rounded"
          >
            取消
          </button>
          {items.length > 0 && (
            <button
              onClick={handlePrint}
              className="button-secondary px-4 py-2 text-sm rounded"
            >
              🖨️ 列印
            </button>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              onClick={() => handleSave('草稿')}
              disabled={saving}
              className="button-secondary px-5 py-2 text-sm rounded disabled:opacity-50"
            >
              {saving ? '儲存中...' : '儲存草稿'}
            </button>
            <button
              onClick={() => handleSave('已送出')}
              disabled={saving}
              className="button-primary px-5 py-2 text-sm rounded disabled:opacity-50"
            >
              {saving ? '送出中...' : '✓ 送出訂單'}
            </button>
          </div>
        )}
        {!canEdit && (
          <span className="text-sm text-gray-400">（僅限閱覽，無編輯權限）</span>
        )}
      </div>

      {/* Product picker panel */}
      <AnimatePresence>
        {showPicker && (
          <ProductPicker
            onAdd={handleAddItem}
            onClose={() => setShowPicker(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Print HTML ─────────────────────────────────────────────────

function buildPrintHtml(data: {
  orderNumber: string
  date: string
  salesperson: string
  note: string
  status: string
  items: OrderItem[]
  customer: SelectedCustomer  // includes companyTitle
}) {
  const totalQty  = data.items.reduce((a, i) => a + i.quantity, 0)
  const totalAmt  = calcTotal(data.items)
  const hasPrice  = data.items.some((i) => i.unitPrice > 0)
  const printTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })

  const rows = data.items.map((item, i) => {
    const lineTotal    = item.unitPrice > 0 ? (item.quantity * item.unitPrice).toLocaleString() : ''
    const unitPriceStr = item.unitPrice > 0 ? item.unitPrice.toLocaleString() : ''
    return `<tr>
      <td class="tc gray">${i + 1}</td>
      <td class="mono sm">${item.skuCode}</td>
      <td class="sm">${item.brand}</td>
      <td class="bold">${item.skuName}</td>
      <td class="tc">${item.quantity}</td>
      ${hasPrice ? `<td class="tr">${unitPriceStr}</td><td class="tr bold">${lineTotal}</td>` : ''}
      <td class="sm gray">${item.note || ''}</td>
    </tr>`
  }).join('')

  const totalRow = hasPrice ? `
    <tr class="total-row">
      <td colspan="4" class="tr" style="padding-right:12px">小計</td>
      <td class="tc">${totalQty}</td>
      <td></td>
      <td class="tr bold" style="font-size:14px">${totalAmt.toLocaleString()}</td>
      <td></td>
    </tr>` : `
    <tr class="total-row">
      <td colspan="4" class="tr" style="padding-right:12px">總數量</td>
      <td class="tc bold">${totalQty}</td>
      <td></td>
    </tr>`

  const c = data.customer

  return `<!DOCTYPE html>
<html lang="zh-TW"><head>
<meta charset="UTF-8">
<title>訂貨單 ${data.orderNumber}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;font-size:12px;color:#111;background:#fff;padding:28px 32px 40px}
  .hd{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:14px;border-bottom:2px solid #111}
  .co{font-size:18px;font-weight:700;letter-spacing:0.02em;line-height:1.3}
  .co-sub{font-size:10px;color:#777;margin-top:2px;letter-spacing:0.06em}
  .doc-meta{text-align:right}
  .doc-type{font-size:10px;color:#777;letter-spacing:0.08em;margin-bottom:4px}
  .doc-num{font-size:22px;font-weight:700;font-family:monospace;letter-spacing:0.06em}
  /* ── 訂單資訊列 ── */
  .info{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #ddd;background:#f8f8f8}
  .info-cell{padding:6px 12px}
  .lbl{font-size:9px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px}
  .val{font-size:12px;font-weight:500;color:#111}
  /* ── 客戶區塊 ── */
  .cust-block{border:1px solid #ddd;border-top:none;background:#fff}
  .cust-title{background:#333;color:#fff;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:4px 12px;text-transform:uppercase}
  .cust-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:0}
  .cust-cell{padding:6px 12px;border-right:1px solid #eee}
  .cust-cell:last-child{border-right:none}
  .cust-name-val{font-size:14px;font-weight:700;color:#111}
  .cust-addr{border-top:1px solid #eee;padding:6px 12px}
  /* ── 品項表格 ── */
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
  th{background:#111;color:#fff;font-weight:600;text-align:left;padding:7px 8px;font-size:10px;letter-spacing:0.04em;white-space:nowrap}
  td{padding:6px 8px;border-bottom:1px solid #e8e8e8}
  tbody tr:nth-child(even) td{background:#f8f8f8}
  .total-row td{background:#333!important;color:#fff;font-weight:600;padding:7px 8px;border:none}
  .tc{text-align:center}.tr{text-align:right}.bold{font-weight:600}
  .mono{font-family:monospace;font-size:10px;color:#666}.sm{font-size:11px}.gray{color:#999}
  .ft{display:flex;justify-content:space-between;margin-top:12px;padding-top:8px;border-top:1px solid #ddd;font-size:10px;color:#aaa}
  .sig{display:flex;gap:40px;margin-top:40px}
  .sig-item{min-width:100px;border-top:1px solid #bbb;padding-top:4px;font-size:10px;color:#888}
  @media print{body{padding:0}}
</style>
</head>
<body>

<!-- Header -->
<div class="hd">
  <div>
    <div class="co">崧達企業股份有限公司</div>
    <div class="co-sub">SONGTAH TRADING CO., LTD.</div>
  </div>
  <div class="doc-meta">
    <div class="doc-type">內部訂貨單 PURCHASE ORDER</div>
    <div class="doc-num">${data.orderNumber}</div>
  </div>
</div>

<!-- 訂單資訊列 -->
<div class="info">
  <div class="info-cell"><div class="lbl">訂貨日期</div><div class="val">${data.date || '—'}</div></div>
  <div class="info-cell"><div class="lbl">業務</div><div class="val">${data.salesperson || '—'}</div></div>
  <div class="info-cell"><div class="lbl">狀態</div><div class="val">${data.status || '—'}</div></div>
  <div class="info-cell"><div class="lbl">備注</div><div class="val">${data.note || '—'}</div></div>
</div>

<!-- 客戶資訊（永遠顯示） -->
<div class="cust-block">
  <div class="cust-title">收貨客戶資訊</div>
  <div class="cust-grid">
    <div class="cust-cell">
      <div class="lbl">客戶名稱</div>
      <div class="cust-name-val">${c.name || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">公司抬頭</div>
      <div class="val">${c.companyTitle || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">聯絡人</div>
      <div class="val">${c.contactPerson || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">電話</div>
      <div class="val">${c.phone || '—'}</div>
    </div>
    <div class="cust-cell">
      <div class="lbl">統一編號</div>
      <div class="val">${c.taxId || '—'}</div>
    </div>
  </div>
  <div class="cust-addr">
    <div class="lbl">地址</div>
    <div class="val">${c.address || '—'}</div>
  </div>
</div>

<!-- Items table -->
<table>
  <thead>
    <tr>
      <th style="width:24px;text-align:center">#</th>
      <th>貨品代碼</th>
      <th>品牌</th>
      <th>品名</th>
      <th style="text-align:center;width:44px">數量</th>
      ${hasPrice ? '<th style="text-align:right;width:72px">單價</th><th style="text-align:right;width:80px">金額</th>' : ''}
      <th>備註</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  ${totalRow}
</table>

<div class="ft">
  <span>共 ${data.items.length} 種品項・總數量 ${totalQty} 件${hasPrice ? `・合計 NT$ ${totalAmt.toLocaleString()}` : ''}</span>
  <span>列印：${printTime}</span>
</div>

<div class="sig">
  <div class="sig-item">訂貨人</div>
  <div class="sig-item">核准</div>
  <div class="sig-item">收貨確認</div>
</div>

</body></html>`
}
