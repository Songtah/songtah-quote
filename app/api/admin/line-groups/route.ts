/** GET /api/admin/line-groups —— 公司 LINE 官方帳號所在的群組（ID＋名稱），確認通知對象用。見 lib/line-groups.ts */
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { listLineGroups } from '@/lib/line-groups'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('central-management', async () => NextResponse.json({ groups: await listLineGroups() }))
