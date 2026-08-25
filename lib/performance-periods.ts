/**
 * lib/performance-periods.ts — 業績統計的期間換算（週／月／季／年）
 *
 * 全部以台北時間計算。與 ceo-stats 的 tzDate 同一套做法：把 UTC 時鐘推 +8h
 * 之後改用 UTC getter/setter，台灣無日光節約，結果等同台北當地日期。
 *
 * 週的定義：以「週一」為一週起點（台灣商務慣例），非週日。
 */

/** salesperson 查詢參數傳這個值代表「全部業務」（僅管理帳號可用） */
export const ALL_SALESPEOPLE = '__all__'

export const PERIODS = ['week', 'month', 'quarter', 'year'] as const
export type Period = (typeof PERIODS)[number]

export const PERIOD_LABEL: Record<Period, string> = {
  week: '本週',
  month: '本月',
  quarter: '本季',
  year: '今年',
}

export const PREVIOUS_PERIOD_LABEL: Record<Period, string> = {
  week: '上週',
  month: '上月',
  quarter: '上季',
  year: '去年',
}

export type PeriodRange = {
  period: Period
  /** 本期起訖（YYYY-MM-DD，含頭含尾） */
  from: string
  to: string
  /** 對照期起訖，用來算成長率 */
  prevFrom: string
  prevTo: string
  /** 顯示用標籤，如「2026 第 3 季」 */
  label: string
}

function tzNow(): Date {
  return new Date(Date.now() + 8 * 3600_000)
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** 該日期所屬「週一」 */
function mondayOf(d: Date): Date {
  // getUTCDay: 0=週日 … 6=週六。要換算成距離週一幾天。
  const offset = (d.getUTCDay() + 6) % 7
  return addDays(d, -offset)
}

export function resolvePeriod(period: Period, now = tzNow()): PeriodRange {
  const today = iso(now)

  if (period === 'week') {
    const start = mondayOf(now)
    const prevStart = addDays(start, -7)
    return {
      period, from: iso(start), to: today,
      prevFrom: iso(prevStart), prevTo: iso(addDays(start, -1)),
      label: `${iso(start)} 起`,
    }
  }

  if (period === 'month') {
    const start = new Date(now); start.setUTCDate(1)
    const prevStart = new Date(start); prevStart.setUTCMonth(prevStart.getUTCMonth() - 1)
    return {
      period, from: iso(start), to: today,
      prevFrom: iso(prevStart), prevTo: iso(addDays(start, -1)),
      label: `${now.getUTCFullYear()} 年 ${now.getUTCMonth() + 1} 月`,
    }
  }

  if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    const start = new Date(now); start.setUTCDate(1); start.setUTCMonth(q * 3)
    const prevStart = new Date(start); prevStart.setUTCMonth(prevStart.getUTCMonth() - 3)
    return {
      period, from: iso(start), to: today,
      prevFrom: iso(prevStart), prevTo: iso(addDays(start, -1)),
      label: `${now.getUTCFullYear()} 年 第 ${q + 1} 季`,
    }
  }

  const start = new Date(now); start.setUTCDate(1); start.setUTCMonth(0)
  const prevStart = new Date(start); prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1)
  return {
    period, from: iso(start), to: today,
    prevFrom: iso(prevStart), prevTo: iso(addDays(start, -1)),
    label: `${now.getUTCFullYear()} 年`,
  }
}

export function parsePeriod(value: string | null | undefined): Period {
  return (PERIODS as readonly string[]).includes(value ?? '') ? (value as Period) : 'month'
}
