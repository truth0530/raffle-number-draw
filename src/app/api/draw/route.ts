import { prisma, ensurePragmas } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { getState, Scene } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 추첨 가능한 씬: 마감 후.
const DRAW_SCENES: Scene[] = ["FROZEN", "DRAWING", "WINNERS"];

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// N명 서버 확정. 이미 당첨된 사람은 제외(추가추첨 중복 차단). 원자적 트랜잭션.
export async function POST(req: Request) {
  await ensurePragmas();
  if (!checkAdmin(req)) return unauthorized();

  let body: { count?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const count = Math.floor(Number(body.count));
  if (!Number.isFinite(count) || count < 1 || count > 1000) {
    return Response.json({ ok: false, error: "invalid_count" }, { status: 422 });
  }

  const state = await getState();
  if (!DRAW_SCENES.includes(state.scene as Scene)) {
    return Response.json(
      { ok: false, error: "not_ready", scene: state.scene },
      { status: 409 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // 아직 당첨되지 않은 응모자만 후보.
    const candidates = await tx.entry.findMany({
      where: { winner: { is: null } },
      select: { id: true },
    });

    const picked = shuffle(candidates.map((c) => c.id)).slice(0, count);

    const lastDraw = await tx.draw.findFirst({ orderBy: { batch: "desc" } });
    const batch = (lastDraw?.batch ?? 0) + 1;
    const startRank = await tx.winner.count();

    const draw = await tx.draw.create({
      data: { batch, count: picked.length },
    });

    for (let i = 0; i < picked.length; i++) {
      await tx.winner.create({
        data: { drawId: draw.id, entryId: picked[i], rank: startRank + i + 1 },
      });
    }

    // 첫 추첨이면 DRAWING 으로 전이(코르크는 닫힌 상태로 시작).
    if (state.scene === "FROZEN") {
      await tx.eventState.update({ where: { id: 1 }, data: { scene: "DRAWING", corkOpen: false } });
    }

    const winners = await tx.winner.findMany({
      where: { drawId: draw.id },
      include: { entry: true },
      orderBy: { rank: "asc" },
    });

    return {
      batch,
      requested: count,
      drawn: picked.length,
      shortfall: count - picked.length,
      newWinners: winners.map((w) => ({
        name: w.entry.name,
        last4: w.entry.last4,
        rank: w.rank,
      })),
    };
  });

  return Response.json({ ok: true, ...result });
}
