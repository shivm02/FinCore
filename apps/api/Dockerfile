# Multi-stage hardened Dockerfile for FinCore Core Express API (Assessment 09)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S fincore && adduser -S fincore -G fincore
COPY --from=deps --chown=fincore:fincore /app/node_modules ./node_modules
COPY --chown=fincore:fincore . .
USER fincore
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
CMD ["node", "src/server.js"]
