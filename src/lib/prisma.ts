import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite: WAL + busy_timeout 로 동시 write 버스트를 안전하게 흡수.
let pragmaDone = false;
export async function ensurePragmas() {
  if (pragmaDone) return;
  pragmaDone = true;
  try {
    // PRAGMA 는 결과행을 반환하므로 queryRawUnsafe 사용(executeRawUnsafe 는 SQLite에서 결과 불가).
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch {
    // provider가 sqlite가 아니면 무시
  }
}
