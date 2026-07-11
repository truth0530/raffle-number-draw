import { randomInt, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { getState, Scene } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 추첨 가능한 씬: 마감 후.
const DRAW_SCENES: Scene[] = ["FROZEN", "DRAWING", "WINNERS"];

// CSPRNG Fisher–Yates: 경품 추첨의 공정성 시비를 원천 차단.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 연속 추첨 가드 창: 이 시간 안의 재추첨은 force 없이는 거부한다.
// 리모컨 새로고침으로 연타 잠금(inFlight)이 풀린 직후의 이중 클릭(20명→40명 사고) 방지.
const RECENT_DRAW_GUARD_MS = 15_000;

// N명 서버 확정. 이미 당첨된 사람은 제외(추가추첨 중복 차단). 원자적 트랜잭션.
export async function POST(req: Request) {
  if (!checkAdmin(req)) return unauthorized();

  let body: { count?: unknown; force?: unknown };
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

  // 직전 추첨과 너무 가까우면 의도 재확인 요구 — 리모컨이 이 응답을 받아
  // "정말 추가 추첨인가?" confirm 을 띄우고 force:true 로 재요청한다.
  if (body.force !== true) {
    const last = await prisma.draw.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, batch: true, count: true },
    });
    const elapsed = last ? Date.now() - last.createdAt.getTime() : Infinity;
    if (last && elapsed < RECENT_DRAW_GUARD_MS) {
      return Response.json(
        {
          ok: false,
          error: "recent_draw",
          secondsAgo: Math.max(1, Math.round(elapsed / 1000)),
          batch: last.batch,
          count: last.count,
        },
        { status: 409 }
      );
    }
  }

  // 후보·순번은 트랜잭션 밖에서 읽는다(원자성 불필요 — 아래 unique 제약이 이중당첨을 원천 차단).
  // 인터랙티브 트랜잭션을 쓰지 않으므로 트랜잭션 풀러(pgbouncer, 6543)에서도 동작한다
  // — 세션 풀러(5432)의 연결 고갈로 수백 명 동시 접속이 끊기던 문제의 근본 해결.
  const candidates = await prisma.entry.findMany({
    where: { winner: { is: null } },
    select: { id: true, name: true, last4: true },
  });
  if (candidates.length === 0) {
    return Response.json({ ok: false, error: "no_candidates" }, { status: 409 });
  }

  const picked = shuffle(candidates.slice()).slice(0, count);
  const lastDraw = await prisma.draw.findFirst({ orderBy: { batch: "desc" }, select: { batch: true } });
  const batch = (lastDraw?.batch ?? 0) + 1;
  const startRank = await prisma.winner.count();
  const drawId = randomUUID();

  // 원자적 쓰기(배열 트랜잭션 = 단일 BEGIN…COMMIT, 트랜잭션 풀러 호환).
  // 동시 추첨이 겹치면 Winner.entryId unique(또는 Draw.batch unique) 위반으로 전체 롤백 →
  // 한 건만 확정되고 나머지는 500(리모컨이 자동 재시도). 기존 당첨자·rank는 절대 안 바뀐다.
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.draw.create({ data: { id: drawId, batch, count: picked.length } }),
    prisma.winner.createMany({
      data: picked.map((c, i) => ({ drawId, entryId: c.id, rank: startRank + i + 1 })),
    }),
  ];
  if (state.scene === "FROZEN") {
    ops.push(prisma.eventState.update({ where: { id: 1 }, data: { scene: "DRAWING", corkOpen: false } }));
  }
  await prisma.$transaction(ops);

  return Response.json({
    ok: true,
    batch,
    requested: count,
    drawn: picked.length,
    shortfall: count - picked.length,
    newWinners: picked.map((c, i) => ({ name: c.name, last4: c.last4, rank: startRank + i + 1 })),
  });
}
