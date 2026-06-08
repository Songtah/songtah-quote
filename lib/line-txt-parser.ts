/**
 * 解析 LINE 群組聊天記錄 .txt 匯出檔案
 *
 * 實際觀察到的格式：
 *   2025/01/08（三）          ← 日期標題（全形括號）
 *   下午04:56\t⁨⁨姓名⁩⁩\t訊息  ← 單行訊息（名字前後有 Unicode 方向符）
 *   下午05:43\t姓名\t"        ← 多行訊息開始（引號）
 *   內容第一行
 *   內容第二行
 *   "                        ← 多行訊息結束
 */

export type LineMessage = {
  date: string    // YYYY-MM-DD
  time: string    // HH:MM
  sender: string
  text: string
}

// 判斷是否為新訊息行（時間\t...）
const IS_MSG_LINE = /^(?:上午|下午)?\d{1,2}:\d{2}\t/

export function parseLineTxt(content: string): LineMessage[] {
  const messages: LineMessage[] = []

  // 正規化：移除 BOM、統一換行、移除 Unicode 方向/格式符號
  const cleaned = content
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[⁨⁩​-‏‪-‮￹-￻]/g, '')

  const lines = cleaned.split('\n')
  let currentDate = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trimEnd()

    // ── 日期標題 ──────────────────────────────────────────────────────────────
    // 2025/01/08（三） 或 2025/01/08(三) 或 2025/01/08
    if (!line.includes('\t')) {
      const dateM = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/)
      if (dateM) {
        const [, y, m, d] = dateM
        currentDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        i++
        continue
      }
    }

    if (!currentDate) { i++; continue }

    // ── 訊息行：TIME\tSENDER\tCONTENT ────────────────────────────────────────
    const msgM = line.match(/^(上午|下午)?(\d{1,2}:\d{2})\t(.+?)\t(.*)$/)
    if (!msgM) { i++; continue }

    const [, period, timeStr, rawSender, firstContent] = msgM
    const sender = rawSender.trim()
    if (!sender) { i++; continue }  // 系統訊息（無 sender）

    // 解析時間
    let [h, min] = timeStr.split(':').map(Number)
    if (period === '下午' && h < 12) h += 12
    if (period === '上午' && h === 12) h = 0
    const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`

    // ── 多行訊息（引號包起來）────────────────────────────────────────────────
    let text = firstContent.trim()

    if (text === '"' || (text.startsWith('"') && !isClosedQuote(text))) {
      const parts: string[] = []
      if (text.startsWith('"') && text.length > 1) parts.push(text.slice(1))
      i++

      while (i < lines.length) {
        const next = lines[i].trimEnd()

        // 結束引號（單獨一個 "）
        if (next === '"') { i++; break }

        // 下一則訊息開始
        if (IS_MSG_LINE.test(next)) break

        // 新日期標題
        if (next.match(/^\d{4}\/\d{1,2}\/\d{1,2}/) && !next.includes('\t')) break

        // 行末引號（此行就是最後一行）
        if (next.endsWith('"') && next !== '"') {
          parts.push(next.slice(0, -1))
          i++
          break
        }

        parts.push(next)
        i++
      }

      text = parts.join('\n').trim()
    } else {
      // 單行：移除首尾引號
      if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
        text = text.slice(1, -1).trim()
      }
      i++
    }

    if (text && sender) {
      messages.push({ date: currentDate, time, sender, text })
    }
  }

  return messages
}

function isClosedQuote(s: string): boolean {
  return s.startsWith('"') && s.length > 1 && s.endsWith('"')
}
