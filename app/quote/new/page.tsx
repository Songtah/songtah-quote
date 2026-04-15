import Image from 'next/image'
import QuoteForm from '@/components/QuoteForm'
import { getProducts } from '@/lib/notion'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function NewQuotePage() {
  await requireViewPermission('quote')

  const products = await getProducts()

  return (
    <div className="min-h-screen bg-cover bg-center bg-no-repeat bg-fixed" style={{ backgroundImage: "url('/background.jpeg')" }}>
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Image src="/Logo.png" alt="崧達企業" width={168} height={55} className="object-contain" />
        <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← 返回列表</a>
      </nav>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold text-white drop-shadow mb-6">新增報價單</h1>
        <QuoteForm products={products} />
      </main>
    </div>
  )
}
