// Next.js App Router 自動把這個當作 Suspense fallback：點「客戶」立刻顯示，資料到了再替換。
import { ShellSkeleton } from '@/components/PageSkeleton'

export default function CustomersLoading() {
  return <ShellSkeleton rows={8} />
}
