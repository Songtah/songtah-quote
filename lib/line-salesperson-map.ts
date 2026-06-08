/**
 * LINE 顯示名稱 → 系統業務姓名對應表
 * 更新時直接修改此檔案即可
 */

const MAP: Record<string, string> = {
  '穎真':       'Amy',
  'Gus':        'Gus',
  'Hank Hsieh': 'Hank',
  'Hsuan':      'James',
  '傅':         'Duncan',
  '孫猴子Eason': 'Eason',
  '郭思賢SAM崧達': 'Sam',
}

/**
 * 將 LINE 顯示名稱轉換為系統業務姓名。
 * 先查完整比對，再查部分包含，都找不到就回傳原名。
 */
export function resolveSalesperson(displayName: string): string {
  if (!displayName) return ''

  // 完整比對
  if (MAP[displayName]) return MAP[displayName]

  // 部分比對（LINE 名稱包含 key，或 key 包含 LINE 名稱）
  for (const [lineKey, systemName] of Object.entries(MAP)) {
    if (displayName.includes(lineKey) || lineKey.includes(displayName)) {
      return systemName
    }
  }

  // 找不到就用原名
  return displayName
}
