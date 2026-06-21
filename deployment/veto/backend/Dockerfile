# Veto Backend — Dockerfile for Render
# Multi-stage build: install deps → generate Prisma → compile TS → run

# ─── Builder ───
FROM node:20-slim AS builder

WORKDIR /app

# Install bun for faster Prisma + installs
RUN npm install -g bun

# Copy package files + Prisma schema first (for layer caching)
COPY package.json bun.lock* ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bun x prisma generate

# Copy source
COPY . .

# Build TypeScript
RUN bun run build

# ─── Production ───
FROM node:20-slim

WORKDIR /app

# Install bun in production too (needed for prisma migrate deploy)
RUN npm install -g bun

# Copy built artifacts + node_modules + prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Expose port (Render sets PORT env var)
EXPOSE 10000

# Start: run migrations, then start the server
# prisma migrate deploy applies any pending migrations before the app starts
CMD ["sh", "-c", "bun x prisma migrate deploy && node dist/index.js"]
