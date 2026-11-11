/**
 * 系統統一的 QR code 樣式（2026-11-11 使用者指定）：圓點資料格＋圓角方框定位點＋圓形定位心，黑底白。
 * 全系統產生 QR code 一律走這裡，不要再直接呼叫 QRCode.toDataURL（那會是方格樣式）。
 * styledQrSvg 是純函式（伺服器也能用）；styledQrDataUrl 只能在瀏覽器用，回傳 PNG 以便下載列印。
 */
import QRCode from 'qrcode'

const QUIET = 3 // 四周留白（格）

export function styledQrSvg(text: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = modules.size
  const total = n + QUIET * 2
  const isFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)

  let dots = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules.get(r, c) || isFinder(r, c)) continue
      dots += `<circle cx="${c + QUIET + 0.5}" cy="${r + QUIET + 0.5}" r="0.5"/>`
    }
  }
  const finder = (r: number, c: number) => {
    const x = c + QUIET, y = r + QUIET
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2" fill="none" stroke="#000" stroke-width="1"/>`
      + `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<g fill="#000">${dots}${finder(0, 0)}${finder(0, n - 7)}${finder(n - 7, 0)}</g></svg>`
}

/** 瀏覽器端：轉成 PNG data URL（預設 1000px，列印夠用）。 */
export function styledQrDataUrl(text: string, size = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('canvas unavailable'))
      ctx.drawImage(img, 0, 0, size, size)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('QR code 產生失敗'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(styledQrSvg(text))}`
  })
}
