# TactiCoach API — multi-stage production image.
# Build:  docker build -t tacticoach-api .
# Run:    docker run --env-file .env -p 3001:3001 tacticoach-api

# ---- Build stage -------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npx prisma generate

COPY src ./src
RUN npm run build

# Drop dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- Runtime stage -----------------------------------------------------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# OpenSSL is required by Prisma's engine at runtime.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json prisma.config.ts ./

EXPOSE 3001
USER node

# Apply pending migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
