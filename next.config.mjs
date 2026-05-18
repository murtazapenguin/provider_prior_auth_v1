import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PolicyPdfViewer.tsx uses @typescript-eslint/no-explicit-any disable
  // comments but the project ESLint config doesn't load that plugin.
  // Skip ESLint during production build; we rely on tsc for type safety.
  eslint: { ignoreDuringBuilds: true },

  experimental: {
    // Keep Prisma and pg outside of the webpack bundle on the server side
    // (Next.js 14 name for what became serverExternalPackages in Next.js 15).
    serverComponentsExternalPackages: ['@prisma/client', 'pg', '@prisma/adapter-pg'],
  },

  webpack(config, { isServer }) {
    // @mui/icons-material@9 has "main": "./src/index.js" in its package.json
    // but the src/ directory is not present in the published package.
    // Fix the main field directly in the package.json (done once in postinstall
    // or here). Also alias sub-path imports that webpack fails to resolve via
    // the exports map.
    // Use $ suffix for exact match so the alias doesn't swallow sub-path imports
    // like @mui/icons-material/FileDownloadOutlined.
    config.resolve.alias['@mui/icons-material$'] = path.resolve(
      __dirname,
      'node_modules/@mui/icons-material/index.js',
    )
    // Sub-path imports need their own explicit entry (one file in the pdf-viewer).
    config.resolve.alias['@mui/icons-material/FileDownloadOutlined'] = require.resolve(
      '@mui/icons-material/FileDownloadOutlined',
    )

    if (isServer) {
      // Prisma 7 and other modern packages import built-ins with the `node:`
      // URI scheme. Webpack 5 doesn't handle `node:` URIs natively — add an
      // externals function so Node.js resolves them at runtime instead.
      const existingExternals = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : []
      config.externals = [
        ...existingExternals,
        ({ request }, callback) => {
          if (request && request.startsWith('node:')) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    } else {
      // Prevent node: built-ins from causing UnhandledSchemeError in client bundles.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        crypto: false,
        path: false,
        os: false,
        stream: false,
        net: false,
        tls: false,
      }
    }

    return config
  },
}

export default nextConfig
