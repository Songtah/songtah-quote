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
    outputFileTracingIncludes: {
      '/support/manual': ['./content/support/**'],
    },
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
