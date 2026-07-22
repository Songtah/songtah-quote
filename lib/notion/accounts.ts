/**
 * lib/notion/accounts.ts — 系統帳號 / 登入（葉領域，從 system-notion.ts 抽出）
 * 密碼一律 bcrypt 雜湊（舊明文於登入時遷移）；權限模型走 ./permissions-model。
 */
import bcrypt from 'bcryptjs'
import {
  notion, DB, transientCache, normalizeDatabaseId, notionCallWithRetry,
  getCachedValue, setCachedValue, richText, getTitle, getText, getSelect,
} from './shared'
import {
  MODULE_NOTION_FIELDS, mapUserPermissions,
  type ModuleKey, type UserPermissions,
} from './permissions-model'

export type SystemUser = {
  id: string
  name: string
  username: string
  accountType: string
  status: string
  assignmentMode: BusinessAssignmentMode
  permissions: UserPermissions
}

export const BUSINESS_ASSIGNMENT_MODES = ['全面開發', '既有客戶維護', '暫停承接'] as const
export type BusinessAssignmentMode = (typeof BUSINESS_ASSIGNMENT_MODES)[number]

function assignmentMode(page: any): BusinessAssignmentMode {
  const value = getSelect(page, '業務承接模式')
  return BUSINESS_ASSIGNMENT_MODES.includes(value as BusinessAssignmentMode)
    ? value as BusinessAssignmentMode
    : '全面開發'
}

export function canAcceptNewBusiness(user: Pick<SystemUser, 'accountType' | 'status' | 'assignmentMode'>): boolean {
  return user.accountType === '業務' && user.status !== '停用' && user.assignmentMode === '全面開發'
}

let _userFieldsEnsured = false
async function ensureUserDbFields() {
  if (_userFieldsEnsured) return
  try {
    const permProps: Record<string, any> = {
      帳號代碼: { rich_text: {} },   // username — needed for login filter
      密碼:   { rich_text: {} },   // password
      業務承接模式: {
        select: { options: BUSINESS_ASSIGNMENT_MODES.map((name) => ({ name })) },
      },
    }
    for (const fields of Object.values(MODULE_NOTION_FIELDS)) {
      permProps[fields.view] = { checkbox: {} }
      permProps[fields.edit] = { checkbox: {} }
    }
    await notion.databases.update({
      database_id: normalizeDatabaseId(DB.users),
      properties: permProps as any,
    })
  } catch (e) {
    console.warn('ensureUserDbFields warning:', e)
  }
  _userFieldsEnsured = true
}

export async function getSystemUsers(): Promise<SystemUser[]> {
  const cacheKey = 'users:all'
  const cached = getCachedValue<SystemUser[]>(cacheKey)
  if (cached) return cached

  await ensureUserDbFields()

  const response: any = await notionCallWithRetry('getSystemUsers', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.users),
      page_size: 50,
    })
  )

  const items: SystemUser[] = (response.results ?? []).map((page: any) => ({
    id: page.id,
    name: getTitle(page, '帳號名稱'),
    username: getText(page, '帳號代碼'),
    accountType: getSelect(page, '帳號類型'),
    status: getSelect(page, '狀態'),
    assignmentMode: assignmentMode(page),
    permissions: mapUserPermissions(page),
  }))

  setCachedValue(cacheKey, items, 600_000) // 10 min
  return items
}

// ── 密碼雜湊（bcrypt，含舊版明文資料的登入時遷移）─────────────────────────────
// bcrypt hash 一律以 $2a$/$2b$/$2y$ 開頭；用這個前綴判斷舊資料是否仍為明文。
const BCRYPT_HASH_RE = /^\$2[aby]\$/
const BCRYPT_ROUNDS = 10

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

async function verifyPassword(stored: string, supplied: string): Promise<boolean> {
  if (BCRYPT_HASH_RE.test(stored)) {
    return bcrypt.compare(supplied, stored)
  }
  // 舊版明文密碼：仍可比對登入，但比對後應立即於呼叫端改寫成雜湊（見 getSystemUserByCredentials）
  return stored === supplied
}

export async function getSystemUserByCredentials(
  username: string,
  password: string
): Promise<SystemUser | null> {
  await ensureUserDbFields()
  const response: any = await notionCallWithRetry('getSystemUserByCredentials', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.users),
      filter: { property: '帳號代碼', rich_text: { equals: username } },
    })
  )
  for (const page of response.results ?? []) {
    const storedPw = getText(page, '密碼')
    const matches = await verifyPassword(storedPw, password)
    if (matches) {
      const status = getSelect(page, '狀態')
      if (status === '停用') return null   // 已停用帳號，拒絕登入

      // 舊版明文密碼登入成功時，當場改寫成雜湊（migrate-on-login），下次起不再是明文。
      if (!BCRYPT_HASH_RE.test(storedPw)) {
        const newHash = await hashPassword(password)
        // 雜湊遷移失敗時拒絕本次登入，避免明文密碼持續留存卻被視為登入成功。
        await notionCallWithRetry('migratePasswordHash', () =>
          notion.pages.update({ page_id: page.id, properties: { 密碼: { rich_text: richText(newHash) } } as any })
        )
      }

      return {
        id: page.id,
        name: getTitle(page, '帳號名稱'),
        username: getText(page, '帳號代碼'),
        accountType: getSelect(page, '帳號類型'),
        status,
        assignmentMode: assignmentMode(page),
        permissions: mapUserPermissions(page),
      }
    }
  }
  return null
}

export async function createSystemUser(data: {
  name: string
  username: string
  password: string
  accountType: string
  status?: string
  assignmentMode?: BusinessAssignmentMode
  permissions: UserPermissions
}): Promise<SystemUser> {
  await ensureUserDbFields()
  const permProps: Record<string, any> = {}
  for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
    const p = data.permissions[mod as ModuleKey]
    permProps[fields.view] = { checkbox: p.view }
    permProps[fields.edit] = { checkbox: p.edit }
  }
  const hashedPassword = await hashPassword(data.password)
  const response: any = await notionCallWithRetry('createSystemUser', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.users) },
      properties: {
        帳號名稱: { title: richText(data.name) },
        帳號代碼: { rich_text: richText(data.username) },
        密碼: { rich_text: richText(hashedPassword) },
        ...(data.accountType ? { 帳號類型: { select: { name: data.accountType } } } : {}),
        ...(data.status ? { 狀態: { status: { name: data.status } } } : {}),
        業務承接模式: { select: { name: data.assignmentMode ?? '全面開發' } },
        ...permProps,
      } as any,
    })
  )
  transientCache.delete('users:all')

  return {
    id: response.id,
    name: data.name,
    username: data.username,
    accountType: data.accountType,
    status: getSelect(response, '狀態') || data.status || '未開始',
    assignmentMode: data.assignmentMode ?? '全面開發',
    permissions: data.permissions,
  }
}

export async function getSystemUserById(id: string): Promise<SystemUser> {
  await ensureUserDbFields()
  const page: any = await notionCallWithRetry('getSystemUserById', () =>
    notion.pages.retrieve({ page_id: id })
  )

  return {
    id: page.id,
    name: getTitle(page, '帳號名稱'),
    username: getText(page, '帳號代碼'),
    accountType: getSelect(page, '帳號類型'),
    status: getSelect(page, '狀態'),
    assignmentMode: assignmentMode(page),
    permissions: mapUserPermissions(page),
  }
}

export async function updateSystemUser(
  id: string,
  data: {
    name?: string
    password?: string
    accountType?: string
    status?: string
    assignmentMode?: BusinessAssignmentMode
    permissions?: UserPermissions
  }
): Promise<void> {
  const properties: Record<string, any> = {}
  if (data.name !== undefined) properties['帳號名稱'] = { title: richText(data.name) }
  if (data.password !== undefined) properties['密碼'] = { rich_text: richText(await hashPassword(data.password)) }
  if (data.accountType !== undefined) properties['帳號類型'] = { select: { name: data.accountType } }
  if (data.status !== undefined) properties['狀態'] = { status: { name: data.status } }
  if (data.assignmentMode !== undefined) properties['業務承接模式'] = { select: { name: data.assignmentMode } }
  if (data.permissions !== undefined) {
    for (const [mod, fields] of Object.entries(MODULE_NOTION_FIELDS)) {
      const p = data.permissions[mod as ModuleKey]
      properties[fields.view] = { checkbox: p.view }
      properties[fields.edit] = { checkbox: p.edit }
    }
  }
  await notionCallWithRetry('updateSystemUser', () =>
    notion.pages.update({ page_id: id, properties } as any)
  )
  transientCache.delete('users:all')
}

export async function deleteSystemUser(id: string): Promise<void> {
  await notionCallWithRetry('deleteSystemUser', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
  transientCache.delete('users:all')
}
