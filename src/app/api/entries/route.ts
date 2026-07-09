import { prisma, ensurePragmas } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 무대 버블용 응모자 목록. 이름은 실시간으로 무대에 뜨는 게 설계 의도(응모 순간의 설레임)라
// 씬과 무관하게 제공한다. 당첨자 명단만 /api/state 에서 공개 씬 게이트로 보호.
export async function GET() {
  await ensurePragmas();
  const rows = await prisma.entry.findMany({
    select: { id: true, name: true, last4: true },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ ok: true, entries: rows });
}
