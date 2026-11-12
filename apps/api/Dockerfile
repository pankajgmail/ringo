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
# Trust Amazon RDS certificates so the API can verify the database's TLS certificate.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
RUN chmod 644 /etc/ssl/rds-global-bundle.pem
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem
WORKDIR /app/apps/api
EXPOSE 8080
USER node
CMD ["sh", "-c", "node --import tsx src/db/migrate.ts && node --import tsx src/server.ts"]
