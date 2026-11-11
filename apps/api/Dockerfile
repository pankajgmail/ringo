# Build from repo root: docker build -f apps/api/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @ringo/api --include-workspace-root --omit=dev || npm install --workspace @ringo/api --omit=dev
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 8080
USER node
CMD ["sh", "-c", "node --import tsx src/db/migrate.ts && node --import tsx src/server.ts"]
