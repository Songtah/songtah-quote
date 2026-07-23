import { Client } from '@notionhq/client'
import { encode } from 'next-auth/jwt'

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
async function requestAs(path, token, init = {}) {
  return fetch(baseUrl + path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      cookie: `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`,
    },
    redirect: 'manual',
  })
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
const salesperson = users.find((user) => user.assignmentMode === '全面開發' && user.status !== '停用' && user.accountType === '業務' && user.name)
if (!salesperson) throw new Error('找不到可用業務帳號')
const legacyOwnerUser = users.find((user) => user.name === 'Duncan' && user.status !== '停用' && user.accountType === '業務')
if (!legacyOwnerUser) throw new Error('找不到 Duncan 業務帳號，無法驗證客戶主檔舊名稱相容')
const retainedPortfolioManager = users.find((user) => user.id === '349dcdaa-fb2a-81cf-b5a6-f15536fa1629' && user.name === 'Gus' && user.status !== '停用')
if (!retainedPortfolioManager) throw new Error('找不到保留既有客戶組合的 Gus 啟用帳號')
const maintenanceUser = users.find((user) => user.assignmentMode === '既有客戶維護' && user.status !== '停用' && user.accountType === '業務' && user.name)
if (!maintenanceUser) throw new Error('找不到「既有客戶維護」帳號')
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

const blockedPayload = {
  city, districts: [selectedAreas[0].district], salespersonId: maintenanceUser.id,
  status: '規劃中', dryRun: true,
}
const blockedTerritory = await request('/api/territories/bulk', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(blockedPayload),
})
if (blockedTerritory.status !== 400 || !(await blockedTerritory.json()).error?.includes('不可承接新轄區')) {
  throw new Error(`既有客戶維護帳號仍可承接轄區：HTTP ${blockedTerritory.status}`)
}
const blockedAssignment = await request('/api/customers/assign', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ city, district: selectedAreas[0].district, salesperson: maintenanceUser.name, dryRun: true }),
})
if (blockedAssignment.status !== 400 || !(await blockedAssignment.json()).error?.includes('不承接新客戶')) {
  throw new Error(`既有客戶維護帳號仍可接收未分派客戶：HTTP ${blockedAssignment.status}`)
}
const blockedReassign = await request('/api/customers/reassign', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: salesperson.name, moves: [{ city, district: selectedAreas[0].district, to: maintenanceUser.name }], dryRun: true }),
})
if (blockedReassign.status !== 400 || !(await blockedReassign.json()).error?.includes('不承接新客戶')) {
  throw new Error(`既有客戶維護帳號仍可接收業務交接：HTTP ${blockedReassign.status}`)
}
const blockedCompanyAssignment = await request('/api/customers/assign-company', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ customerIds: ['codex-dry-run'], from: '公司', to: maintenanceUser.name, dryRun: true }),
})
if (blockedCompanyAssignment.status !== 400 || !(await blockedCompanyAssignment.json()).error?.includes('不承接新客戶')) {
  throw new Error(`既有客戶維護帳號仍可接收公司客戶：HTTP ${blockedCompanyAssignment.status}`)
}

const adminPage = await request('/admin/clinic-monitor?tab=territory')
const adminPageHtml = await adminPage.text()
if (!adminPage.ok || !adminPageHtml.includes('業務轄區管理')) throw new Error('主管轄區頁面無法開啟')
if (!adminPageHtml.includes('Gus')) throw new Error('列印業務總表選項仍未出現 Gus')
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

  const reportResponse = await request(`/bd/territories/${createdIds[0]}/report?type=${encodeURIComponent('牙醫診所')}`)
  const reportHtml = await reportResponse.text()
  if (!reportResponse.ok || !reportHtml.includes('轄區客戶報表') || !reportHtml.includes('內部機密')) {
    throw new Error(`轄區列印報表無法開啟：HTTP ${reportResponse.status}`)
  }
  if (reportHtml.includes('institutionCode') || reportHtml.includes('phone') || reportHtml.includes('address')) {
    throw new Error('轄區列印報表洩漏未授權的敏感欄位')
  }
  if (!process.env.NEXTAUTH_SECRET) throw new Error('缺少 NEXTAUTH_SECRET，無法驗證一般業務報表權限')
  const businessToken = await encode({
    secret: process.env.NEXTAUTH_SECRET, maxAge: 600,
    token: {
      sub: salesperson.id, uid: salesperson.id, name: salesperson.name,
      role: 'user', accountType: '業務',
      permissions: { bd: { view: true, edit: true }, clinic_monitor: { view: false, edit: false } },
    },
  })
  const businessReportResponse = await requestAs(`/bd/territories/${createdIds[0]}/report`, businessToken)
  const businessReportHtml = await businessReportResponse.text()
  if (!businessReportResponse.ok || !businessReportHtml.includes('轄區客戶報表')) {
    throw new Error(`負責業務無法開啟自己的報表：HTTP ${businessReportResponse.status}`)
  }
  const combinedTerritoryReportResponse = await request(`/bd/salespersons/${salesperson.id}/report?scope=territories`)
  const combinedTerritoryReportHtml = await combinedTerritoryReportResponse.text()
  if (!combinedTerritoryReportResponse.ok || !combinedTerritoryReportHtml.includes('全部轄區總名單') || !selectedAreas.every((area) => combinedTerritoryReportHtml.includes(area.district))) {
    throw new Error(`業務轄區總報表無法合併多區：HTTP ${combinedTerritoryReportResponse.status}`)
  }
  if (combinedTerritoryReportHtml.includes('institutionCode') || combinedTerritoryReportHtml.includes('phone') || combinedTerritoryReportHtml.includes('address')) {
    throw new Error('業務轄區總報表洩漏未授權的敏感欄位')
  }
  const teamTerritoryList = await json(await request(`/api/bd/my-customer-list?scope=territories&territoryId=${createdIds[0]}`), '主管讀取團隊轄區客戶')
  if (teamTerritoryList.items.some((item) => item.salesperson !== salesperson.name)) {
    throw new Error('團隊轄區清單混入非該轄區負責業務的客戶')
  }
  if (JSON.stringify(teamTerritoryList).includes('address') || JSON.stringify(teamTerritoryList).includes('phone') || JSON.stringify(teamTerritoryList).includes('institutionCode')) {
    throw new Error('團隊轄區清單一次洩漏敏感欄位')
  }
  const companyReportResponse = await request('/bd/salespersons/company/report?scope=customers')
  const companyReportHtml = await companyReportResponse.text()
  if (!companyReportResponse.ok || !companyReportHtml.includes('公司客戶') || !companyReportHtml.includes('既有客戶名單')) {
    throw new Error(`公司客戶報表無法開啟：HTTP ${companyReportResponse.status}`)
  }
  if (Number(companyReportHtml.match(/data-customer-count="(\d+)"/)?.[1] ?? 0) <= 0) {
    throw new Error('公司客戶報表沒有產出任何名下客戶')
  }
  if (companyReportHtml.includes('institutionCode') || companyReportHtml.includes('phone') || companyReportHtml.includes('address')) {
    throw new Error('公司客戶報表洩漏未授權的敏感欄位')
  }
  const businessCombinedReportResponse = await requestAs(`/bd/salespersons/${salesperson.id}/report?scope=territories`, businessToken)
  const businessCombinedReportHtml = await businessCombinedReportResponse.text()
  if (!businessCombinedReportResponse.ok || !businessCombinedReportHtml.includes('全部轄區總名單')) {
    throw new Error(`業務無法開啟自己的轄區總報表：HTTP ${businessCombinedReportResponse.status}`)
  }
  const forbiddenCompanyReport = await requestAs('/bd/salespersons/company/report?scope=customers', businessToken)
  if (![302, 303, 307, 308].includes(forbiddenCompanyReport.status) || !forbiddenCompanyReport.headers.get('location')?.endsWith('/bd')) {
    throw new Error(`一般業務仍可開啟公司客戶報表：HTTP ${forbiddenCompanyReport.status}`)
  }
  const retainedPortfolioReportResponse = await request(`/bd/salespersons/${retainedPortfolioManager.id}/report?scope=customers`)
  const retainedPortfolioReportHtml = await retainedPortfolioReportResponse.text()
  if (!retainedPortfolioReportResponse.ok || !retainedPortfolioReportHtml.includes('Gus') || !retainedPortfolioReportHtml.includes('既有客戶名單')) {
    throw new Error(`Gus 既有客戶報表無法開啟：HTTP ${retainedPortfolioReportResponse.status}`)
  }
  const retainedPortfolioCount = Number(retainedPortfolioReportHtml.match(/data-customer-count="(\d+)"/)?.[1] ?? 0)
  if (retainedPortfolioCount <= 0) throw new Error('Gus 既有客戶報表沒有產出任何名下客戶')
  const forbiddenRetainedPortfolioReport = await requestAs(`/bd/salespersons/${retainedPortfolioManager.id}/report?scope=customers`, businessToken)
  if (forbiddenRetainedPortfolioReport.status !== 307 || !forbiddenRetainedPortfolioReport.headers.get('location')?.endsWith('/bd')) {
    throw new Error(`一般業務仍可開啟 Gus 既有客戶報表：HTTP ${forbiddenRetainedPortfolioReport.status}`)
  }
  const businessPopupList = await json(await requestAs('/api/bd/my-customer-list?scope=territories', businessToken), '讀取業務端轄區彈跳清單')
  if (businessPopupList.items.some((item) => item.salesperson !== salesperson.name)) {
    throw new Error('業務端轄區彈跳清單混入未認領或其他負責人的客戶')
  }
  if (JSON.stringify(businessPopupList).includes('address') || JSON.stringify(businessPopupList).includes('phone') || JSON.stringify(businessPopupList).includes('institutionCode')) {
    throw new Error('業務端轄區彈跳清單洩漏敏感欄位')
  }
  const businessExistingList = await json(await requestAs('/api/bd/my-customer-list?scope=customers', businessToken), '讀取業務本人既有客戶')
  if (businessExistingList.items.length <= 0 || businessExistingList.items.some((item) => item.salesperson !== salesperson.name)) {
    throw new Error('業務本人既有客戶清單範圍錯誤')
  }
  const legacyOwnerToken = await encode({
    secret: process.env.NEXTAUTH_SECRET, maxAge: 600,
    token: {
      sub: legacyOwnerUser.id, uid: legacyOwnerUser.id, name: legacyOwnerUser.name,
      role: 'user', accountType: '業務',
      permissions: { bd: { view: true, edit: true }, clinic_monitor: { view: false, edit: false } },
    },
  })
  const legacyOwnerReportResponse = await requestAs(`/bd/salespersons/${legacyOwnerUser.id}/report?scope=customers`, legacyOwnerToken)
  const legacyOwnerReportHtml = await legacyOwnerReportResponse.text()
  if (!legacyOwnerReportResponse.ok || !legacyOwnerReportHtml.includes('既有客戶名單')) {
    throw new Error(`Duncan 既有客戶報表無法開啟：HTTP ${legacyOwnerReportResponse.status}`)
  }
  const legacyOwnerPopup = await json(await requestAs('/api/bd/my-customer-list?scope=customers', legacyOwnerToken), '讀取 Duncan 既有客戶彈跳清單')
  if (legacyOwnerPopup.items.length <= 0 || legacyOwnerPopup.items.some((item) => item.salesperson !== legacyOwnerUser.name)) {
    throw new Error('Duncan 舊負責業務名稱未正確轉換成目前帳號名稱')
  }
  const maintenanceToken = await encode({
    secret: process.env.NEXTAUTH_SECRET, maxAge: 600,
    token: {
      sub: maintenanceUser.id, uid: maintenanceUser.id, name: maintenanceUser.name,
      role: 'user', accountType: '業務',
      permissions: { bd: { view: true, edit: true }, clinic_monitor: { view: false, edit: false } },
    },
  })
  const maintenanceTerritoriesResponse = await requestAs('/api/bd/territories', maintenanceToken)
  const maintenanceTerritories = await json(maintenanceTerritoriesResponse, '讀取既有客戶維護業務的轄區狀態')
  if (maintenanceTerritories.assignmentMode !== '既有客戶維護') throw new Error('業務端未顯示既有客戶維護模式')
  const maintenanceCustomerReportResponse = await requestAs(`/bd/salespersons/${maintenanceUser.id}/report?scope=customers`, maintenanceToken)
  const maintenanceCustomerReportHtml = await maintenanceCustomerReportResponse.text()
  if (!maintenanceCustomerReportResponse.ok || !maintenanceCustomerReportHtml.includes('既有客戶名單') || !maintenanceCustomerReportHtml.includes('依客戶主檔目前負責業務產出')) {
    throw new Error(`維護模式業務無法列印既有客戶名單：HTTP ${maintenanceCustomerReportResponse.status}`)
  }
  const maintenanceReportCount = Number(maintenanceCustomerReportHtml.match(/data-customer-count="(\d+)"/)?.[1] ?? 0)
  if (maintenanceReportCount <= 0) throw new Error('既有客戶報表沒有產出任何名下客戶')
  const maintenancePopupList = await json(await requestAs('/api/bd/my-customer-list?scope=customers', maintenanceToken), '讀取維護模式業務的既有客戶彈跳清單')
  if (maintenancePopupList.items.length <= 0 || maintenancePopupList.items.some((item) => item.salesperson !== maintenanceUser.name)) {
    throw new Error('維護模式業務的彈跳清單未正確顯示名下客戶')
  }
  const detailCustomerId = maintenancePopupList.items[0].id
  const maintenanceDetail = await json(await requestAs(`/api/bd/customer-detail/${detailCustomerId}`, maintenanceToken), '讀取本人客戶詳細資料')
  if (maintenanceDetail.customer.salesperson !== maintenanceUser.name || maintenanceDetail.classification?.level !== '內部機密') {
    throw new Error('本人客戶詳細資料權限或分級錯誤')
  }
  if ('taxId' in maintenanceDetail.customer || 'institutionCode' in maintenanceDetail.customer) {
    throw new Error('業務客戶詳細資料回傳超出業務必要的敏感欄位')
  }
  const forbiddenOtherDetail = await requestAs(`/api/bd/customer-detail/${detailCustomerId}`, businessToken)
  if (forbiddenOtherDetail.status !== 403) {
    throw new Error(`業務仍可查看其他業務客戶詳情：HTTP ${forbiddenOtherDetail.status}`)
  }
  const adminDetail = await json(await request(`/api/bd/customer-detail/${detailCustomerId}`), '主管讀取團隊客戶詳情')
  if (adminDetail.customer.id !== detailCustomerId) throw new Error('主管團隊客戶詳情回傳錯誤')
  const forbiddenMaintenanceTerritory = await requestAs(`/api/bd/my-customer-list?scope=territories&territoryId=${createdIds[0]}`, maintenanceToken)
  if (forbiddenMaintenanceTerritory.status !== 403) {
    throw new Error(`業務仍可查看非本人轄區清單：HTTP ${forbiddenMaintenanceTerritory.status}`)
  }
  if (maintenanceCustomerReportHtml.includes('institutionCode') || maintenanceCustomerReportHtml.includes('phone') || maintenanceCustomerReportHtml.includes('address')) {
    throw new Error('既有客戶名單報表洩漏未授權的敏感欄位')
  }
  const maintenancePipeline = await json(await requestAs('/api/bd/pipeline', maintenanceToken), '讀取既有客戶維護業務的開發漏斗')
  if (!maintenancePipeline.existingOnly || maintenancePipeline.opportunityLeads.length !== 0 || maintenancePipeline.items.some((item) => item.salesperson !== maintenanceUser.name)) {
    throw new Error('既有客戶維護業務的漏斗仍混入未認領客戶或新商機')
  }
  const pipelineClaimCandidate = customerSnapshots.flatMap((snapshot) => snapshot.items).find((item) => !item.salesperson && !['已歇業', '停業', '撤銷'].includes(item.status))
  if (!pipelineClaimCandidate) throw new Error('找不到未認領客戶，無法驗證維護模式漏斗認領防護')
  const blockedPipelineClaim = await requestAs('/api/bd/pipeline', maintenanceToken, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: pipelineClaimCandidate.id, salesperson: maintenanceUser.name, devStage: '線索', devSource: 'Codex 驗收' }),
  })
  if (blockedPipelineClaim.status !== 403 || !(await blockedPipelineClaim.json()).error?.includes('不承接')) {
    throw new Error(`既有客戶維護業務仍可從漏斗認領：HTTP ${blockedPipelineClaim.status}`)
  }
  const maintenanceSuggestionQuery = new URLSearchParams({ city, district: selectedAreas[0].district, salesperson: maintenanceUser.name })
  const maintenanceSuggestions = await json(
    await requestAs(`/api/bd/visit-suggestions?${maintenanceSuggestionQuery}`, maintenanceToken),
    '讀取既有客戶維護業務的拜訪建議',
  )
  if (!maintenanceSuggestions.existingOnly || maintenanceSuggestions.groups.C.length !== 0) {
    throw new Error('既有客戶維護業務仍取得陌生開發建議')
  }
  const maintenanceSuggested = [...maintenanceSuggestions.groups.A, ...maintenanceSuggestions.groups.B]
  if (maintenanceSuggested.some((item) => item.salesperson !== maintenanceUser.name)) {
    throw new Error('既有客戶維護業務的拜訪建議混入非本人客戶')
  }
  const hiddenSample = customerSnapshots[0].items.find((item) => item.salesperson && item.salesperson !== salesperson.name)
  if (hiddenSample && businessReportHtml.includes(hiddenSample.name)) {
    throw new Error(`一般業務報表洩漏其他負責人的客戶：${hiddenSample.name}`)
  }
  if (hiddenSample && businessCombinedReportHtml.includes(hiddenSample.name)) {
    throw new Error(`一般業務轄區總報表洩漏其他負責人的客戶：${hiddenSample.name}`)
  }
  const otherUserToken = await encode({
    secret: process.env.NEXTAUTH_SECRET, maxAge: 600,
    token: {
      sub: 'codex-other-account', uid: 'codex-other-account', name: 'Codex 其他業務',
      role: 'user', accountType: '業務',
      permissions: { bd: { view: true, edit: true }, clinic_monitor: { view: false, edit: false } },
    },
  })
  const forbiddenReport = await requestAs(`/bd/territories/${createdIds[0]}/report`, otherUserToken)
  if (forbiddenReport.status !== 307 || !forbiddenReport.headers.get('location')?.endsWith('/bd')) {
    throw new Error(`非負責業務未被報表頁拒絕：HTTP ${forbiddenReport.status}`)
  }
  const forbiddenCombinedReport = await requestAs(`/bd/salespersons/${salesperson.id}/report?scope=territories`, otherUserToken)
  if (forbiddenCombinedReport.status !== 307 || !forbiddenCombinedReport.headers.get('location')?.endsWith('/bd')) {
    throw new Error(`非本人仍可開啟業務總報表：HTTP ${forbiddenCombinedReport.status}`)
  }
  const forbiddenPopupList = await requestAs('/api/bd/my-customer-list?scope=customers', otherUserToken)
  if (forbiddenPopupList.status !== 403) throw new Error(`無正式業務帳號仍可讀取彈跳清單：HTTP ${forbiddenPopupList.status}`)

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
    typeStats: true, typeCandidateFilter: true, printableReport: true,
    combinedTerritoryReport: true, existingCustomerReport: true, combinedReportAuthorization: true,
    retainedPortfolioManagerReport: true, retainedPortfolioManagerAuthorization: true,
    businessPopupLists: true, popupListAuthorization: true, teamTerritoryCustomerLookup: true,
    businessOwnCustomersOnly: true, customerDetailAuthorization: true, customerDetailClassification: true,
    sensitiveFieldsMinimized: true, businessOwnReport: true, otherBusinessRejected: true,
    maintenanceMode: true, maintenanceTerritoryBlocked: true, maintenanceNewAssignmentBlocked: true,
    maintenanceReassignBlocked: true, maintenanceCompanyAssignmentBlocked: true, maintenanceSuggestionsExistingOnly: true,
    maintenancePipelineExistingOnly: true, maintenancePipelineClaimBlocked: true,
    otherOwnerDetailsHidden: hiddenSample ? true : 'no-sample', concurrentUnique: true, claimDryRun, inactiveGuard,
  }, null, 2))
} finally {
  if (createdIds.length && process.env.NOTION_TOKEN) {
    const notion = new Client({ auth: process.env.NOTION_TOKEN })
    await Promise.allSettled(createdIds.map((id) => notion.pages.update({ page_id: id, archived: true })))
  }
}
