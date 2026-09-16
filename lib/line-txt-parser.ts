/**
 * 解析 LINE 群組聊天記錄 .txt 匯出檔案。支援兩種匯出格式：
 *
 * A) Tab 分隔（手機版匯出）
 *   2025/01/08（三）          ← 日期標題（全形括號）
 *   下午04:56\t⁨⁨姓名⁩⁩\t訊息  ← 單行訊息（名字前後有 Unicode 方向符）
 *   下午05:43\t姓名\t"        ← 多行訊息開始（引號）
 *   內容第一行
 *   "                        ← 多行訊息結束
 *
 * B) 空白分隔、24 小時制（2026-09 收到的另一種匯出）
 *   2025.01.08 星期三          ← 日期標題
 *   16:56 崧達 Edward 訊息內容  ← 發話人與內容之間沒有分隔符號，發話人本身還可能有空白
 *   續行直接接在下一行（沒有引號包覆）
 *
 * B 格式無法單靠符號切出發話人，因此：優先用呼叫端給的 knownSenders（業務顯示名稱）比對最長前綴；
 * 沒給或比不到時，退回「出現 3 次以上的前綴」統計法猜發話人。
 */

export type LineMessage = {
  date: string    // YYYY-MM-DD
  time: string    // HH:MM
  sender: string
  text: string
}

// 判斷是否為新訊息行（時間\t...）
const IS_MSG_LINE = /^(?:上午|下午)?\d{1,2}:\d{2}\t/

/** B 格式的日期標題：2025.01.08 星期三 */
const DOT_DATE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\s+星期[一二三四五六日天])?\s*$/
/** B 格式的訊息開頭：16:56 發話人 內容 */
const SPACE_MSG = /^(\d{1,2}):(\d{2})\s+(.+)$/

export function parseLineTxt(content: string, knownSenders: string[] = []): LineMessage[] {
  // 正規化：移除 BOM、統一換行、移除 Unicode 方向/格式符號
  const cleaned = content
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[⁨⁩​-‏‪-‮￹-￻]/g, '')

  const lines = cleaned.split('\n')

  // 先判斷是哪一種格式：有 Tab 訊息行就是 A，否則看有沒有「2025.01.08」這種日期標題
  const hasTabMessages = lines.some((l) => IS_MSG_LINE.test(l))
  if (!hasTabMessages && lines.some((l) => DOT_DATE.test(l.trimEnd()))) {
    return parseSpaceSeparated(lines, knownSenders)
  }
  return parseTabSeparated(lines)
}

function parseTabSeparated(lines: string[]): LineMessage[] {
  const messages: LineMessage[] = []
  let currentDate = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trimEnd()

    // ── 日期標題 ──────────────────────────────────────────────────────────────
    // 2025/01/08（三） 或 2025/01/08(三) 或 2025/01/08
    // 注意：尾端加 $ 避免把「2026/1/17 明年第一場課程...」這類訊息誤判為日期標題
    if (!line.includes('\t')) {
      const dateM = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*[（(][一二三四五六日][）)])?$/)
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

// ── B 格式：空白分隔、24 小時制 ───────────────────────────────────────────────

/**
 * 猜出檔案裡的發話人名單：把每則訊息開頭的前 1～4 個詞當候選，
 * 出現 3 次以上才算人名（訊息內容碰巧重複開頭的機率低）。
 * 只在呼叫端沒給 knownSenders、或給的比不到時才用。
 */
function guessSenders(lines: string[]): Set<string> {
  const counts = new Map<string, number>()
  for (const line of lines) {
    const m = line.trimEnd().match(SPACE_MSG)
    if (!m) continue
    const words = m[3].split(' ').filter(Boolean)
    for (let n = 1; n <= Math.min(4, words.length); n++) {
      const key = words.slice(0, n).join(' ')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return new Set(Array.from(counts.entries()).filter(([, c]) => c >= 3).map(([k]) => k))
}

function parseSpaceSeparated(lines: string[], knownSenders: string[]): LineMessage[] {
  const messages: LineMessage[] = []
  // 長的名字先比，避免「Hank」比中了而漏掉「Hank Hsieh」
  const known = [...knownSenders].sort((a, b) => b.length - a.length)
  const guessed = guessSenders(lines)

  const splitSender = (rest: string): { sender: string; text: string } => {
    for (const name of known) {
      if (rest === name) return { sender: name, text: '' }
      if (rest.startsWith(name + ' ')) return { sender: name, text: rest.slice(name.length + 1) }
    }
    const words = rest.split(' ').filter(Boolean)
    for (let n = Math.min(4, words.length); n >= 1; n--) {
      const key = words.slice(0, n).join(' ')
      if (guessed.has(key)) return { sender: key, text: words.slice(n).join(' ') }
    }
    return { sender: words[0] ?? '', text: words.slice(1).join(' ') }
  }

  let currentDate = ''
  let current: LineMessage | null = null
  const push = () => {
    if (current && current.text.trim() && current.sender) messages.push({ ...current, text: current.text.trim() })
    current = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const dateM = line.match(DOT_DATE)
    if (dateM) {
      push()
      currentDate = `${dateM[1]}-${dateM[2].padStart(2, '0')}-${dateM[3].padStart(2, '0')}`
      continue
    }
    if (!currentDate) continue

    const msgM = line.match(SPACE_MSG)
    if (msgM) {
      push()
      const { sender, text } = splitSender(msgM[3])
      current = {
        date: currentDate,
        time: `${msgM[1].padStart(2, '0')}:${msgM[2]}`,
        sender,
        text,
      }
      continue
    }
    // 續行：屬於上一則訊息（這個格式的多行訊息沒有引號包覆）
    if (current) current.text += '\n' + line
  }
  push()
  return messages
}
