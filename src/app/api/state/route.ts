import { prisma } from "@/lib/prisma";
import { getState, REVEAL_SCENES, Scene } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 무대·리모컨이 폴링하는 공개 상태. 당첨자 명단은 공개 씬(DRAWING/WINNERS)에서만 포함.
export async function GET() {
  const state = await getState();
  const entryCount = await prisma.entry.count();
  // 리허설(가상) 응모 잔존 감시 — 본행사에 가상 인물이 당첨되는 사고 방지용 경고 데이터.
  const rehearsalCount = await prisma.entry.count({ where: { ip: "rehearsal" } });

  const reveal = REVEAL_SCENES.includes(state.scene as Scene);

  let winners: { entryId: string; name: string; last4: string; rank: number; batch: number }[] = [];
  if (reveal) {
    const rows = await prisma.winner.findMany({
      include: { entry: true, draw: true },
      orderBy: { rank: "asc" },
    });
    winners = rows.map((w) => ({
      entryId: w.entryId,
      name: w.entry.name,
      last4: w.entry.last4,
      rank: w.rank,
      batch: w.draw.batch,
    }));
  }

  return Response.json({
    ok: true,
    scene: state.scene,
    entryCount,
    rehearsalCount,
    frozenAt: state.frozenAt,
    qr: { visible: state.qrVisible, size: state.qrSize, corner: state.qrCorner },
    cork: state.corkOpen,
    shakeAt: state.shakeAt,
    drawDuration: state.drawDuration,
    tiltDeg: state.tiltDeg,
    winners, // 비공개 씬에서는 항상 []
  });
}
