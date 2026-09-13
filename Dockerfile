FROM oven/bun:1 AS builder
WORKDIR /repo
ENV HUSKY=0 NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
ENV DATABASE_URL=file:/app/data/kinesthesia.db
# Standalone output keeps the workspace layout, so the server sits under its own
# app directory with the hoisted modules beside it.
COPY --from=builder --chown=bun:bun /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=bun:bun /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=bun:bun /repo/apps/web/public ./apps/web/public
# The standalone server changes into its own directory, so the migrations it
# reads at runtime sit beside it rather than at the image root.
COPY --from=builder --chown=bun:bun /repo/apps/web/drizzle ./apps/web/drizzle
RUN mkdir -p /app/data && chown bun:bun /app/data
USER bun
EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
