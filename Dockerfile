# Full node_modules (not `output: "standalone"`) is kept deliberately: it
# means `pnpm seed-user` / `pnpm db-query` work inside the running container
# exactly like they do in local dev (they need `tsx`, a devDependency, which
# a pruned standalone build wouldn't include).

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
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
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
USER nextjs

EXPOSE 2999
CMD ["pnpm", "start"]
