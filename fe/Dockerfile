# Debian slim (glibc) — reliable sharp/@img native bindings on linux-x64 (Render amd64).
# Alpine/musl standalone images often miss @img/sharp-libvips-* and break RSC renders.
FROM node:22-bookworm-slim AS base

FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild sharp for the container OS so @img/sharp-linux-x64 + libvips are present.
# Also verify TipTap editor deps (fails early vs opaque webpack "Can't resolve").
RUN npm rebuild sharp \
    && node -e "require('sharp'); require('@tiptap/extensions'); require('@tiptap/react')"

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_BACKEND_API_URL
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_SSE_ENABLED
ARG NEXT_PUBLIC_ENVIRONMENT
ARG NEXT_PUBLIC_LOG_LEVEL
ARG NEXT_PUBLIC_LOG_JSON
ARG NEXT_DEPLOYMENT_ID
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ARG NEXT_PUBLIC_APP_RELEASE
ARG NEXT_PUBLIC_APP_BUILD
ARG NEXT_PUBLIC_APP_ENV
ARG RENDER_GIT_COMMIT

ENV NEXT_PUBLIC_BACKEND_API_URL=${NEXT_PUBLIC_BACKEND_API_URL:-}
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL:-}
ENV NEXT_PUBLIC_APP_NAME="${NEXT_PUBLIC_APP_NAME:-Clinicle Intelligence App}"
ENV NEXT_PUBLIC_SSE_ENABLED=${NEXT_PUBLIC_SSE_ENABLED:-}
ENV NEXT_PUBLIC_ENVIRONMENT=${NEXT_PUBLIC_ENVIRONMENT:-production}
ENV NEXT_PUBLIC_LOG_LEVEL=${NEXT_PUBLIC_LOG_LEVEL:-INFO}
ENV NEXT_PUBLIC_LOG_JSON=${NEXT_PUBLIC_LOG_JSON:-true}
ENV NEXT_PUBLIC_APP_RELEASE=${NEXT_PUBLIC_APP_RELEASE:-}
ENV NEXT_PUBLIC_APP_BUILD=${NEXT_PUBLIC_APP_BUILD:-}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV:-}
ENV NEXT_DEPLOYMENT_ID=${NEXT_DEPLOYMENT_ID:-}
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}
ENV RENDER_GIT_COMMIT=${RENDER_GIT_COMMIT:-}

# package.json `build` sets NODE_OPTIONS=6144 via cross-env, which OOMs Docker
# Desktop during "Generating static pages". Invoke next directly with a smaller
# heap and one static-generation worker (same pattern as LMS).
ENV NODE_OPTIONS='--max-old-space-size=3072'
ENV NEXT_BUILD_CPUS=1
RUN npx next build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Standalone trace can omit sharp platform packages; copy from builder (linux-x64 on Render).
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp

RUN rm -rf /usr/local/lib/node_modules/npm

# Fail the image build if sharp cannot load (catches missing libvips before deploy).
RUN node -e "require('sharp')"

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
