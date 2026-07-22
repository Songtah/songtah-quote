import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getSystemUsers } from '@/lib/notion/accounts'
import {
  getTerritory, updateTerritory, TERRITORY_STATUSES, type TerritoryStatus,
} from '@/lib/notion/territories'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

type Ctx = { params: { id: string } }

function clean(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export const PATCH = withApiAuth<Ctx>({ roles: ['中央管理', '總經理'] }, async (req, { params }, session) => {
  try {
    const body = await req.json()
    const before = await getTerritory(params.id)
    const requestedSalespersonId = body.salespersonId === undefined ? undefined : clean(body.salespersonId, 80)
    let salesperson: string | undefined
    const status = body.status === undefined ? undefined : clean(body.status, 20)
    const startDate = body.startDate === undefined ? undefined : clean(body.startDate, 10) || null
    const note = body.note === undefined ? undefined : clean(body.note, 1000)
    let salespersonId: string | undefined
    if (status && !TERRITORY_STATUSES.includes(status as TerritoryStatus)) {
      return NextResponse.json({ error: '無效的轄區狀態' }, { status: 400 })
    }
    if (requestedSalespersonId !== undefined) {
      if (!requestedSalespersonId) return NextResponse.json({ error: '負責業務不可空白' }, { status: 400 })
      const users = await getSystemUsers()
      const selectedUser = users.find((user) => user.id === requestedSalespersonId && user.status !== '停用' && user.accountType === '業務')
      if (!selectedUser) {
        return NextResponse.json({ error: '負責業務不是有效的啟用帳號' }, { status: 400 })
      }
      salesperson = selectedUser.name
      salespersonId = selectedUser.id
    }
    const item = await updateTerritory(params.id, {
      salesperson, salespersonId, status: status as TerritoryStatus | undefined, startDate, note,
    })
    await logAuditEvent({
      module: 'clinic_monitor', action: 'update', entityType: 'territory',
      entityId: item.id, entityTitle: item.name,
      summary: `更新業務轄區：${item.city}${item.district}（未修改客戶）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req), before, after: item,
    }).catch((error) => console.error('audit territory update error:', error))
    return NextResponse.json({ item, customerChanges: 0 })
  } catch (error: any) {
    console.error('territory PATCH error:', error)
    return NextResponse.json({ error: error?.message || '更新轄區失敗' }, { status: 500 })
  }
})

export const DELETE = withApiAuth<Ctx>({ roles: ['中央管理', '總經理'] }, async (req, { params }, session) => {
  try {
    const before = await getTerritory(params.id)
    const item = await updateTerritory(params.id, { status: '結束' })
    await logAuditEvent({
      module: 'clinic_monitor', action: 'delete', entityType: 'territory',
      entityId: item.id, entityTitle: item.name,
      summary: `結束業務轄區：${item.city}${item.district}（客戶歸屬保持不變）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req), before, after: item,
    }).catch((error) => console.error('audit territory end error:', error))
    return NextResponse.json({ item, customerChanges: 0 })
  } catch (error: any) {
    console.error('territory DELETE error:', error)
    return NextResponse.json({ error: error?.message || '結束轄區失敗' }, { status: 500 })
  }
})
