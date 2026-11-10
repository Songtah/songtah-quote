/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Next 14 的 key 是 experimental.serverComponentsExternalPackages;
  // serverExternalPackages 要 Next 15 才認得,寫在這裡會被靜默忽略。
  experimental: {
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
    // 操作手冊以 fs 在執行時讀取，明確打包進 serverless 函式，避免部署後讀不到檔案
    // 產品目錄／系列 JSON 含內部基準價，放 data/catalog（不公開），所有路由的函式都帶上
    outputFileTracingIncludes: {
      '/support/manual': ['./content/support/**'],
      '/**/*': ['./data/catalog/**'],
      // 牙科類醫療器材許可證索引（食藥署開放資料），法規合規監測比對用
      '/api/admin/compliance/**': ['./data/compliance/**'],
    },
  },
  // 用戶端元件會從 lib/system-notion 等檔案 import 常數與型別，連帶把伺服器端的資料庫驅動（postgres）拉進瀏覽器包。
  // 瀏覽器端一律以空模組取代 Node 內建模組；資料庫連線只在伺服器端建立（lib/db/client.ts）。
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = { ...(config.resolve.fallback ?? {}), net: false, tls: false, fs: false, perf_hooks: false, crypto: false, stream: false, os: false, dns: false, child_process: false }
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // 支援中心以 iframe 嵌入操作手冊：僅此路徑放寬為同源可嵌入（後面的規則覆蓋前面的 DENY）
        source: '/support/manual',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ]
  },
}

export default nextConfig
