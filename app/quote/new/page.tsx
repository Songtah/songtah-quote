import Image from 'next/image'
import QuoteForm from '@/components/QuoteForm'
import { getProducts } from '@/lib/notion'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function NewQuotePage() {
  await requireViewPermission('quote')

  const products = await getProducts()

  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-100 via-cream-200 to-brand-100">
      <nav className="bg-white/90 backdrop-blur-md border-b border-brand-200/40 px-6 py-3 flex items-center justify-between">
        <Image src="/Logo.svg" alt="崧達企業" width={168} height={55} className="object-contain" />
        <a href="/dashboard" className="text-sm text-stone-500 hover:text-stone-700 transition">← 返回列表</a>
      </nav>
      <div className="gold-line" />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold text-stone-800 mb-6">新增報價單</h1>
        <QuoteForm products={products} />
      </main>
    </div>
  )
}
