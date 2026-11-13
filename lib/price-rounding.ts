/** 批次漲幅計算（前後端共用；lib/product-pricing 為伺服器端紀錄與公告） */
export type Rounding = 'round1' | 'round10' | 'round100' | 'ceil10' | 'ceil100' | 'floor10' | 'floor100'
export const ROUNDING_OPTIONS: { key: Rounding; label: string }[] = [
  { key: 'round1', label: '四捨五入到個位' },
  { key: 'round10', label: '四捨五入到十位' },
  { key: 'round100', label: '四捨五入到百位' },
  { key: 'ceil10', label: '無條件進位到十位' },
  { key: 'ceil100', label: '無條件進位到百位' },
  { key: 'floor10', label: '無條件捨去到十位' },
  { key: 'floor100', label: '無條件捨去到百位' },
]

export function adjustPrice(price: number, percent: number, rounding: Rounding): number {
  const raw = price * (1 + percent / 100)
  const step = rounding.endsWith('100') ? 100 : rounding.endsWith('10') ? 10 : 1
  // 先修掉浮點誤差（例 1000×1.1＝1100.0000000002 不該進位到 1110）
  const value = Math.round(raw * 1000) / 1000 / step
  const rounded = rounding.startsWith('ceil') ? Math.ceil(value) : rounding.startsWith('floor') ? Math.floor(value) : Math.round(value)
  return Math.max(step, rounded * step)
}
