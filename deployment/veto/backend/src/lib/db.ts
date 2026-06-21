/**
 * Prisma client singleton.
 * Prevents multiple instances during hot reload in dev.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["query", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
