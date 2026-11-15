import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(configDir, '..')

function readReleaseVersion() {
  try {
    return fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim()
  } catch {
    return ''
  }
}

function readGitShaShort() {
  try {
    return execSync('git rev-parse --short=7 HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return 'local'
  }
}

const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID?.trim() ||
  process.env.RENDER_GIT_COMMIT?.trim() ||
  process.env.GITHUB_SHA?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  (process.env.NODE_ENV === 'production' ? undefined : 'development')

const buildCpus = Number.parseInt(process.env.NEXT_BUILD_CPUS || '', 10)
const staticGenerationLimits =
  Number.isFinite(buildCpus) && buildCpus > 0
    ? { cpus: buildCpus, staticGenerationMaxConcurrency: buildCpus }
    : {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // App lives in fe/; parent repo also has package-lock.json
  outputFileTracingRoot: configDir,
  output: 'standalone',
  // Native sharp bindings (@img/sharp-libvips-*) are not always traced into standalone on Alpine.
  serverExternalPackages: ['sharp', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/': ['./node_modules/sharp/**/*', './node_modules/@img/**/*'],
  },
  ...(deploymentId ? { deploymentId } : {}),
  generateBuildId: async () => deploymentId ?? 'development',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['localhost', '*.localhost', '*.local'],
  env: {
    NEXT_PUBLIC_APP_RELEASE: process.env.NEXT_PUBLIC_APP_RELEASE || readReleaseVersion(),
    NEXT_PUBLIC_APP_BUILD:
      process.env.NEXT_PUBLIC_APP_BUILD || `local-${readGitShaShort()}`,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV || 'local',
  },
  experimental: {
    // Large limit for video uploads via server actions to R2
    serverActions: {
      bodySizeLimit: '4gb',
    },
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'date-fns',
      'date-fns-tz',
      '@radix-ui/react-icons',
    ],
    ...staticGenerationLimits,
  },
  async headers() {
    return []
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false

    // For server-side API routes, externalize pdfjs-dist to avoid webpack bundling issues
    if (isServer) {
      config.externals = config.externals || []
      const originalExternals = config.externals
      config.externals = [
        ...(Array.isArray(originalExternals) ? originalExternals : [originalExternals]),
        ({ request }, callback) => {
          if (request && request.includes('pdfjs-dist')) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    }

    return config
  },
}

// Bundle analyzer is a devDependency; only load when ANALYZE=true (local `npm run analyze`).
// Production Docker images run `npm prune --production`, so a static import breaks `next start`.
export default async function loadNextConfig() {
  if (process.env.ANALYZE === 'true') {
    const { default: bundleAnalyzer } = await import('@next/bundle-analyzer')
    return bundleAnalyzer({ enabled: true, openAnalyzer: true })(nextConfig)
  }
  return nextConfig
}
