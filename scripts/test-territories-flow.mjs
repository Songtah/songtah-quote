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
    for (const match of value.matchAll(/((?:__Secure-|__Host-)?next-auth\.[^=,;\s]+)=([^,;]*)/g)) cookies.set(match[1], match[2])
  }
}
function cookieHeader() {
  return Array.from(cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ')
}
async function request(path, init = {}) {
  const response = await fetch(baseUrl + path, {
    ...init, headers: { ...(init.headers || {}), cookie: cookieHeader() }, redirect: 'manual',
  })
  absorbCookies(response)
  return response
}
async function json(response, label) {
  const body = await response.json()
  if (!response.ok) throw new Error(`${label}：HTTP ${response.status} ${body.error || ''}`)
  return body
}
async function customersIn(area) {
  const query = new URLSearchParams({ city: area.city, district: area.district })
  return json(await request(`/api/customers/by-area?${query}`), `讀取 ${area.city}${area.district} 客戶`)
}
function ownershipFingerprint(customers) {
  return customers.items.map((item) => `${item.id}:${item.salesperson || ''}`).sort().join('|')
}

const { csrfToken } = await json(await request('/api/auth/csrf'), '取得登入驗證碼')
const signInResponse = await request('/api/auth/callback/credentials', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ csrfToken, username, password, callbackUrl: `${baseUrl}/admin/clinic-monitor?tab=territory`, json: 'true' }),
})
if (![200, 302].includes(signInResponse.status)) throw new Error(`登入失敗：HTTP ${signInResponse.status}`)
const session = await json(await request('/api/auth/session'), '確認登入狀態')
if (!session?.user) throw new Error('登入後沒有 session')

const [before, users, areaOptions] = await Promise.all([
  json(await request('/api/territories'), '讀取現有轄區'),
  json(await request('/api/accounts'), '讀取業務帳號'),
  json(await request('/api/territories/areas'), '讀取轄區選項'),
])
const salesperson = users.find((user) => user.status !== '停用' && user.accountType === '業務' && user.name)
if (!salesperson) throw new Error('找不到可用業務帳號')
const occupied = new Set(before.items.map((item) => `${item.city}|${item.district}`))
const areasByCity = new Map()
for (const area of areaOptions.items) {
  if (occupied.has(`${area.city}|${area.district}`)) continue
  if (!areasByCity.has(area.city)) areasByCity.set(area.city, [])
  areasByCity.get(area.city).push(area)
}
const testAreas = Array.from(areasByCity.values()).find((items) => items.length >= 3)?.slice(0, 3)
if (!testAreas) throw new Error('找不到同縣市三個可供測試的行政區')
const selectedAreas = testAreas.slice(0, 2)
const concurrentArea = testAreas[2]
const city = selectedAreas[0].city

const adminPage = await request('/admin/clinic-monitor?tab=territory')
if (!adminPage.ok || !(await adminPage.text()).includes('業務轄區管理')) throw new Error('主管轄區頁面無法開啟')
const bdPage = await request('/bd')
if (!bdPage.ok || !(await bdPage.text()).includes('業務開發')) throw new Error('業務開發頁面無法開啟')

const customerSnapshots = await Promise.all(selectedAreas.map(customersIn))
const ownershipBefore = customerSnapshots.map(ownershipFingerprint)
let createdIds = []
try {
  const payload = {
    city, districts: selectedAreas.map((area) => area.district), salespersonId: salesperson.id,
    status: '規劃中', note: 'Codex 批次端到端驗收（完成後清除）',
  }
  const preview = await json(await request('/api/territories/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, dryRun: true }),
  }), '預覽批次新增轄區')
  if (preview.customerChanges !== 0 || preview.districts.length !== 2) throw new Error('批次預覽結果不正確')
  if (!preview.districts.every((area) => typeof area.byType?.['牙醫診所'] === 'number')) throw new Error('類型市場統計缺漏')

  const created = await json(await request('/api/territories/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, dryRun: false }),
  }), '批次建立測試轄區')
  createdIds = created.items.map((item) => item.id)
  if (created.customerChanges !== 0 || createdIds.length !== 2) throw new Error('批次建立結果不正確')

  const ownershipAfter = await Promise.all(selectedAreas.map(customersIn))
  if (ownershipAfter.some((customers, index) => ownershipFingerprint(customers) !== ownershipBefore[index])) {
    throw new Error('批次建立轄區後客戶負責業務發生變化')
  }
  const readBack = await json(await request('/api/territories'), '讀回測試轄區')
  if (!createdIds.every((id) => readBack.items.some((item) => item.id === id))) throw new Error('批次建立後讀回缺少轄區')

  const bdTerritories = await json(await request('/api/bd/territories'), '讀取業務端轄區')
  if (!createdIds.every((id) => bdTerritories.items.some((item) => item.id === id))) throw new Error('業務端沒有同步顯示批次轄區')
  if (!bdTerritories.areas.every((area) => typeof area.byType?.['牙體技術所'] === 'number')) throw new Error('業務端類型統計缺漏')

  const concurrentPayload = {
    city, districts: [concurrentArea.district], salespersonId: salesperson.id,
    status: '規劃中', note: 'Codex 並行唯一性驗收（完成後清除）', dryRun: false,
  }
  const concurrentResponses = await Promise.all([1, 2].map(() => request('/api/territories/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(concurrentPayload),
  })))
  const concurrentBodies = await Promise.all(concurrentResponses.map((response) => response.json()))
  const successIndexes = concurrentResponses.flatMap((response, index) => response.status === 201 ? [index] : [])
  const conflictStatuses = concurrentResponses.filter((response) => response.status === 409).length
  if (successIndexes.length !== 1 || conflictStatuses !== 1) {
    throw new Error(`並行唯一性失效：HTTP ${concurrentResponses.map((response) => response.status).join('/')}`)
  }
  const concurrentCreated = concurrentBodies[successIndexes[0]].items ?? []
  createdIds.push(...concurrentCreated.map((item) => item.id))
  const afterConcurrent = await json(await request('/api/territories'), '讀回並行測試轄區')
  const concurrentMatches = afterConcurrent.items.filter((item) => item.city === city && item.district === concurrentArea.district)
  if (concurrentMatches.length !== 1) throw new Error(`並行建立留下 ${concurrentMatches.length} 筆相同行政區`)

  const preferredType = Object.entries(selectedAreas[0].byType).find(([, count]) => count > 0)?.[0] || '牙醫診所'
  const candidates = await json(await request(`/api/territories/${createdIds[0]}/candidates?type=${encodeURIComponent(preferredType)}`), '讀取類型篩選未開發名單')
  if (!candidates.items.every((item) => item.type === preferredType)) throw new Error('未開發名單類型篩選失效')
  let claimDryRun = false
  if (candidates.items.length > 0) {
    const candidate = candidates.items[0]
    const claimPreview = await json(await request(`/api/territories/${createdIds[0]}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerIds: [candidate.id], dryRun: true }),
    }), '預覽認領客戶')
    if (!claimPreview.eligible[0] || claimPreview.eligible[0].devStage !== (candidate.devStage || '線索')) throw new Error('認領預覽沒有保留既有階段')
    claimDryRun = true
  }

  let inactiveGuard = 'no-sample'
  const inactiveCandidate = customerSnapshots[0].items.find((item) => !item.salesperson && ['已歇業', '停業', '撤銷'].includes(item.status))
  if (inactiveCandidate) {
    const inactivePreview = await json(await request(`/api/territories/${createdIds[0]}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerIds: [inactiveCandidate.id], dryRun: true }),
    }), '驗證停業客戶拒絕規則')
    if (inactivePreview.eligible.length || !inactivePreview.skipped[0]?.reason?.includes('機構狀態')) throw new Error('停業客戶未被資料層拒絕')
    inactiveGuard = 'passed'
  }

  for (const id of createdIds) {
    const ended = await json(await request(`/api/territories/${id}`, { method: 'DELETE' }), '結束測試轄區')
    if (ended.customerChanges !== 0) throw new Error('結束轄區修改了客戶')
  }
  console.log(JSON.stringify({
    authenticated: true, adminPage: true, bdPage: true, bulkPreview: 2, bulkCreated: 2,
    customerChanges: 0, ownershipUnchanged: true, bdTerritoriesSynced: true,
    typeStats: true, typeCandidateFilter: true, concurrentUnique: true, claimDryRun, inactiveGuard,
  }, null, 2))
} finally {
  if (createdIds.length && process.env.NOTION_TOKEN) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN })
    await Promise.allSettled(createdIds.map((id) => notion.pages.update({ page_id: id, archived: true })))
  }
}
