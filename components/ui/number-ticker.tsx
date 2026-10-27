"use client"

/**
 * NumberTicker —— 數字顯示；數值「變動」時才用彈簧動畫過渡。
 *
 * 2026-10-27 修正：原本一律先顯示 startValue（0），等元件進入畫面、瀏覽器播放動畫才跳到實際數字。
 * 首頁數字卡因此每次先閃「待追蹤 0、進行中報價 0」；分頁在背景、減少動態效果、截圖時永遠停在 0
 * （伺服器資料是 203，畫面是 0）。改為一開始就顯示正確數字（伺服器端輸出即正確），之後數值變動才動畫；
 * 使用者設定減少動態效果時直接換數字。
 */
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useMotionValue, useSpring, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  /** 保留舊參數相容；初始一律顯示 value */
  startValue?: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
}

export function NumberTicker({
  value,
  startValue: _startValue,
  direction: _direction,
  delay: _delay,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()
  const motionValue = useMotionValue(value)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const format = (n: number) =>
    Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(Number(n.toFixed(decimalPlaces)))

  // 數值變動：減少動態效果時直接換，否則彈簧過渡
  useEffect(() => {
    if (reduceMotion) {
      springValue.jump(value)
      if (ref.current) ref.current.textContent = format(value)
      return
    }
    motionValue.set(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduceMotion])

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [springValue, decimalPlaces]
  )

  return (
    <span
      ref={ref}
      className={cn("inline-block tracking-wider text-black tabular-nums dark:text-white", className)}
      {...props}
    >
      {format(value)}
    </span>
  )
}
