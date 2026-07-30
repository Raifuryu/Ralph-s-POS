# `builder` (full node_modules, incl. devDependencies like tsx) doubles as
# the image for one-off admin scripts (`pnpm seed-user`/`pnpm db-query`) via
# docker-compose.yml's `tools` service. `runner` below is the lean
# `output: "standalone"` runtime the `app` service actually runs — it never
# invokes pnpm at runtime, which avoids pnpm's own pre-flight lockfile check
# misfiring (no TTY to confirm a reinstall) on node_modules copied in from
# an earlier build stage.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat tzdata
# The store is in the Philippines — every displayed date/time already pins
# Asia/Manila explicitly (lib/format.ts), but mysql2's default date parsing
# (see lib/mysql/pool.ts) reads the Node process's own local timezone, so
# this needs to actually be Asia/Manila for that to line up.
ENV TZ=Asia/Manila
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=2999
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs

EXPOSE 2999
CMD ["node", "server.js"]
