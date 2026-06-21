# Veto Backend — Dockerfile for Render
FROM node:20-slim

WORKDIR /app

# Install bun for Prisma + faster installs
RUN npm install -g bun

# Copy package files
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

# Expose port (Render sets PORT env var)
EXPOSE 10000

# Start the server
CMD ["node", "dist/index.js"]
