import { NextRequest, NextResponse } from 'next/server'
import { listCourseCosts, createCourseCost } from '@/lib/system-notion'
import { withApiAuth } from '@/lib/api-auth'

export const GET = withApiAuth({ module: 'course_costs', action: 'view' }, async () => {
  const items = await listCourseCosts()
  return NextResponse.json(items)
})

export const POST = withApiAuth({ module: 'course_costs', action: 'edit' }, async (req: NextRequest) => {
  const body = await req.json()
  const item = await createCourseCost(body)
  return NextResponse.json(item, { status: 201 })
})
