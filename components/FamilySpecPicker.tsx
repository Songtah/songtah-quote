'use client'

import { useState, useMemo } from 'react'

// ── Exported types ────────────────────────────────────────────

export interface FamilySpec {
  key: string
  label: string
  options: string[]
}

export interface ProductFamily {
  id: string
  collectionName?: string
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
  /** SKU → ERP 原始品名；規格顯示可簡化，但加入單據時不得改寫品名快照。 */
  skuNameMap?: Record<string, string>
  /** 無法由規格表完整表達時，明確列出的系列成員 SKU。 */
  coveredSkuCodes?: string[]
  /** 後台人工指定的系列成員；可能不在規格矩陣 skuMap 中。 */
  manualAssignedSkuCodes?: string[]
  /** 已停售或中央停用的 SKU；pattern 系列用於阻止選到停用品。 */
  unavailableSkuCodes?: string[]
  source?: 'catalog' | 'notion'
  /** 特殊 UI 變體。'ymh-tooth-grid' = YAMAHACHI 牙型座標格 */
  uiVariant?: string
}

// ── Exported helpers ──────────────────────────────────────────

/** 從樣板字串與規格選擇建立貨品碼或品名 */
export function buildFromPattern(pattern: string, selections: Record<string, string>): string {
  let result = pattern
  for (const [key, val] of Object.entries(selections)) {
    result = result.replace(`{${key}}`, val)
  }
  return result
}

// ── Internal helpers ──────────────────────────────────────────

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

const SUBPOS_LABEL: Record<string, string> = {
  整排:'整排', L1:'左1', L2:'左2', L3:'左3', R1:'右1', R2:'右2', R3:'右3',
  // 後牙位置（臼齒）
  LL4:'左下4', LL5:'左下5', LL6:'左下6', LL7:'左下7',
  LU4:'左上4', LU5:'左上5', LU6:'左上6', LU7:'左上7',
  RL4:'右下4', RL5:'右下5', RL6:'右下6', RL7:'右下7',
  RU4:'右上4', RU5:'右上5', RU6:'右上6', RU7:'右上7',
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
            onKeyDown={(event) => {
              if (!isAvail || (event.key !== 'Enter' && event.key !== ' ')) return
              event.preventDefault()
              onSelect(t.id)
            }}
            role="button"
            tabIndex={isAvail ? 0 : -1}
            aria-label={`${jaw}${t.label}`}
            aria-pressed={isSel}
            aria-disabled={!isAvail}
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

// ── YMHToothGridPanel（YAMAHACHI 牙型座標格） ─────────────────

export function YMHToothGridPanel({
  family,
  onAdd,
  actionLabel,
  resetAfterAction = true,
}: {
  family: ProductFamily
  onAdd: (skuCode: string, skuName: string) => void
  actionLabel?: string
  resetAfterAction?: boolean
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
  const isUnavailable = Boolean(skuCode && family.unavailableSkuCodes?.includes(skuCode))
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
    'min-h-11 px-4 py-2.5 rounded-full text-xs font-semibold border transition-all active:scale-95',
    disabled ? 'bg-stone-50 border-stone-200 text-stone-300 cursor-not-allowed' :
    sel       ? 'bg-brand-500 border-brand-500 text-white shadow-md shadow-brand-500/25' :
                'bg-white border-stone-200 text-stone-600 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50',
  ].join(' ')

  const tab = (sel: boolean) => [
    'min-h-12 px-6 py-2 rounded-full text-sm font-semibold border transition-all active:scale-95',
    sel ? 'bg-brand-500 border-brand-500 text-white shadow-md shadow-brand-500/25'
        : 'bg-white border-stone-200 text-stone-600 hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50',
  ].join(' ')

  const toothBtn = (sel: boolean) => [
    'min-h-11 px-3 py-2 rounded-full text-xs font-mono font-semibold border transition-all min-w-[2.75rem] text-center active:scale-95',
    sel ? 'bg-brand-500 border-brand-500 text-white shadow-md shadow-brand-500/25'
        : 'bg-white border-stone-200 text-stone-600 hover:border-brand-400 hover:bg-brand-50',
  ].join(' ')

  return (
    <div className="space-y-4 border-t border-stone-900/[0.05] bg-stone-50/80 px-3 py-4 sm:px-5">

      {/* ① 顏色 */}
      <div>
        <div className="text-xs font-semibold text-brand-600 mb-2">顏色 (Shade)</div>
        <div className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {colorSpec?.options.map((c) => (
            <button type="button" key={c} onClick={() => handleColor(c)} className={chip(color === c)}>{c}</button>
          ))}
        </div>
      </div>

      {color && <>
        {/* ② 上下顎 */}
        <div>
          <div className="text-xs font-semibold text-brand-600 mb-2">上下顎</div>
          <div className="flex gap-2">
            {(['上顎','下顎'] as const).map((j) => (
              <button type="button" key={j} onClick={() => handleJaw(j)} className={tab(jaw === j)}>{j}</button>
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
                  <span className="w-14 shrink-0 pt-3 text-right text-xs text-stone-400">{label}</span>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <button type="button" key={item} onClick={() => handleBase(item)} className={toothBtn(base === item)}>
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
                <button type="button" key={q} onClick={() => handleQty(q)} className={chip(qty === q)}>
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
                <button type="button"
                  onClick={() => setSubPos(subPos === '整排' ? '' : '整排')}
                  className={chip(subPos === '整排')}
                >
                  整排（不指定牙位）
                </button>
              </div>
            )}
            {/* 牙弓 SVG：點選單顆位置 */}
            {subPositions.some((p) => p !== '整排') && (
              <div className="overflow-x-auto rounded-2xl bg-white px-3 py-2 ring-1 ring-stone-900/[0.05]">
                <div className="mb-1 min-w-[330px] text-center text-[10px] text-stone-400">
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
          <div className="card-soft flex flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-snug text-stone-800">{skuName}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-stone-400">{skuCode}</div>
            </div>
            <button type="button"
              onClick={() => {
                if (isUnavailable) return
                onAdd(skuCode, skuName)
                if (resetAfterAction) {
                  setBase(''); setSubPos(''); setQty('')
                }
              }}
              disabled={isUnavailable}
              className="min-h-12 shrink-0 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
            >
              {isUnavailable ? '不符合目前篩選' : (actionLabel ?? '+ 加入')}
            </button>
          </div>
        ) : (
          <div className="text-xs text-stone-400">
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

export function FamilySpecPanel({
  family,
  onAdd,
  actionLabel,
  resetAfterAction = true,
}: {
  family: ProductFamily
  onAdd: (skuCode: string, skuName: string) => void
  actionLabel?: string
  resetAfterAction?: boolean
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
        // Previous spec not yet chosen → hide this row (progressive disclosure)
        rows.push({ spec, options: [], visible: false, specIdx: i })
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
    ? (family.skuNameMap?.[skuCode] ?? (family.namePattern
        ? buildFromPattern(family.namePattern, selected)
        : visibleRows.map((r) => selected[r.spec.key]).filter(Boolean).join(' · ')))
    : ''
  const isUnavailable = Boolean(skuCode && family.unavailableSkuCodes?.includes(skuCode))
  const isValid = allSelected && skuCode !== '' && !isUnavailable

  return (
    <div className="border-t border-stone-900/[0.05] bg-stone-50/80 px-5 py-4 space-y-4">
      {visibleRows.map(({ spec, options, specIdx }) => {
        const isConfirmed = !!selected[spec.key]
        // "confirmed" row: show only the selected chip + an "×" to clear
        if (isConfirmed) {
          return (
            <div key={spec.key} className="flex items-center gap-2">
              <span className="min-w-[2rem] max-w-[5rem] shrink-0 text-right text-xs leading-tight text-stone-400">{spec.label}</span>
              <button type="button"
                onClick={() => handleChip(spec.key, specIdx, selected[spec.key])}
                className="flex min-h-11 items-center gap-1.5 rounded-full border border-brand-500 bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all active:scale-95"
              >
                {selected[spec.key]}
                <span className="opacity-70 text-[10px]">✕</span>
              </button>
            </div>
          )
        }
        // "active" row: show all available options
        return (
          <div key={spec.key}>
            <div className="text-xs font-semibold text-brand-600 mb-2">{spec.label}</div>
            <div className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {options.map((opt) => (
                <button type="button"
                  key={opt}
                  onClick={() => handleChip(spec.key, specIdx, opt)}
                  className="min-h-11 shrink-0 snap-start rounded-full border border-stone-200 bg-white px-4 py-2.5 text-xs font-medium text-stone-700 transition-all hover:border-brand-400 hover:text-brand-600 active:scale-95"
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {/* 結果區 */}
      <div className="pt-1">
        {allSelected ? (
          isValid ? (
            <div className="card-soft flex flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug text-stone-800">{skuName}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-stone-400">{skuCode}</div>
              </div>
              <button type="button"
                onClick={() => {
                  onAdd(skuCode, skuName)
                  if (resetAfterAction) setSelected({})
                }}
                className="min-h-12 shrink-0 rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"
              >
                {actionLabel ?? '+ 加入'}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-600" role="status">
              {isUnavailable ? '此品項已停用，請選擇其他規格' : '此規格組合無對應貨品，請重新選擇'}
            </div>
          )
        ) : (
          <div className="text-xs text-stone-400">
            請選擇{family.specs.find((s) => !selected[s.key])?.label ?? ''}
          </div>
        )}
      </div>
    </div>
  )
}
