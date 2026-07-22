import { Client } from '@notionhq/client'

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'
const username = process.env.APP_USERNAME
const password = process.env.APP_PASSWORD
if (!username || !password) throw new Error('缺少 APP_USERNAME / APP_PASSWORD')

const cookies = new Map()
function absorbCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || '']
  for (const value of values) {
    for (const match of value.matchAll(/((?:__Secure-|__Host-)?next-auth\.[^=,;\s]+)=([^,;]*)/g)) {
      cookies.set(match[1], match[2])
    }
  }
}
function cookieHeader() {
  return Array.from(cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ')
}
async function request(path, init = {}) {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: { ...(init.headers || {}), cookie: cookieHeader() },
    redirect: 'manual',
  })
  absorbCookies(response)
  return response
}
async function json(response, label) {
  const body = await response.json()
  if (!response.ok) throw new Error(`${label}：HTTP ${response.status} ${body.error || ''}`)
  return body
}

const csrfResponse = await request('/api/auth/csrf')
const { csrfToken } = await json(csrfResponse, '取得登入驗證碼')
const signInResponse = await request('/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrfToken, username, password, callbackUrl: `${baseUrl}/admin/clinic-monitor?tab=territory`, json: 'true' }),
})
if (![200, 302].includes(signInResponse.status)) throw new Error(`登入失敗：HTTP ${signInResponse.status}`)
const session = await json(await request('/api/auth/session'), '確認登入狀態')
if (!session?.user) throw new Error('登入後沒有 session')

const before = await json(await request('/api/territories'), '讀取現有轄區')
const users = await json(await request('/api/accounts'), '讀取業務帳號')
const areaOptions = await json(await request('/api/territories/areas'), '讀取轄區選項')
const salesperson = users.find((user) => user.status !== '停用' && user.accountType === '業務' && user.name)
if (!salesperson) throw new Error('找不到可用業務帳號')

const occupied = new Set(before.items.map((item) => `${item.city}|${item.district}`))
const area = areaOptions.items.find((item) => !occupied.has(`${item.city}|${item.district}`))
if (!area) throw new Error('找不到可供測試的未設定轄區')

const pageResponse = await request('/admin/clinic-monitor?tab=territory')
const pageHtml = await pageResponse.text()
if (!pageResponse.ok || !pageHtml.includes('業務轄區管理')) throw new Error('轄區管理頁面無法開啟')
const areaQuery = new URLSearchParams({ city: area.city, district: area.district })
const customersBefore = await json(await request(`/api/customers/by-area?${areaQuery}`), '讀取建立前客戶')
const ownershipBefore = customersBefore.items.map((item) => `${item.id}:${item.salesperson || ''}`).sort().join('|')

let createdId = ''
try {
  const payload = { ...area, salespersonId: salesperson.id, status: '規劃中', note: 'Codex 端到端驗收（完成後清除）' }
  const preview = await json(await request('/api/territories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, dryRun: true }),
  }), '預覽新增轄區')
  if (preview.customerChanges !== 0) throw new Error('預覽顯示會修改客戶，停止驗收')

  const created = await json(await request('/api/territories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, dryRun: false }),
  }), '建立測試轄區')
  createdId = created.item.id
  if (created.customerChanges !== 0) throw new Error('建立結果回報客戶異動不為 0')

  const customersAfterCreate = await json(await request(`/api/customers/by-area?${areaQuery}`), '讀取建立後客戶')
  const ownershipAfterCreate = customersAfterCreate.items.map((item) => `${item.id}:${item.salesperson || ''}`).sort().join('|')
  if (ownershipBefore !== ownershipAfterCreate) throw new Error('建立轄區後客戶負責業務發生變化')

  const readBack = await json(await request('/api/territories'), '讀回測試轄區')
  if (!readBack.items.some((item) => item.id === createdId)) throw new Error('建立後讀回找不到測試轄區')

  const candidates = await json(await request(`/api/territories/${createdId}/candidates`), '讀取未開發名單')
  let claimDryRun = false
  let inactiveGuard = 'no-sample'
  if (candidates.items.length > 0) {
    const candidate = candidates.items[0]
    const claimPreview = await json(await request(`/api/territories/${createdId}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerIds: [candidate.id], dryRun: true }),
    }), '預覽認領客戶')
    const eligible = claimPreview.eligible[0]
    if (!eligible || eligible.devStage !== (candidate.devStage || '線索')) {
      throw new Error('認領預覽沒有保留既有開發階段')
    }
    const customersAfterClaimPreview = await json(await request(`/api/customers/by-area?${areaQuery}`), '讀取認領預覽後客戶')
    const ownershipAfterClaimPreview = customersAfterClaimPreview.items.map((item) => `${item.id}:${item.salesperson || ''}`).sort().join('|')
    if (ownershipBefore !== ownershipAfterClaimPreview) throw new Error('dry-run 認領修改了客戶負責業務')
    claimDryRun = true
  }
  const inactiveCandidate = customersBefore.items.find((item) =>
    !item.salesperson && ['已歇業', '停業', '撤銷'].includes(item.status)
  )
  if (inactiveCandidate) {
    const inactivePreview = await json(await request(`/api/territories/${createdId}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerIds: [inactiveCandidate.id], dryRun: true }),
    }), '驗證停業客戶拒絕規則')
    if (inactivePreview.eligible.length !== 0 || !inactivePreview.skipped[0]?.reason?.includes('機構狀態')) {
      throw new Error('停業客戶未被資料層拒絕')
    }
    inactiveGuard = 'passed'
  }

  const ended = await json(await request(`/api/territories/${createdId}`, { method: 'DELETE' }), '結束測試轄區')
  if (ended.customerChanges !== 0) throw new Error('結束轄區結果回報客戶異動不為 0')

  console.log(JSON.stringify({
    authenticated: true,
    pageRendered: true,
    previewCustomerChanges: preview.customerChanges,
    createCustomerChanges: created.customerChanges,
    ownershipUnchanged: true,
    readBack: true,
    candidateEndpoint: true,
    candidateCount: candidates.items.length,
    claimDryRun,
    inactiveGuard,
    endCustomerChanges: ended.customerChanges,
  }, null, 2))
} finally {
  if (createdId && process.env.NOTION_TOKEN) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN })
    await notion.pages.update({ page_id: createdId, archived: true })
  }
}
