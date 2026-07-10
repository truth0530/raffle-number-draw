import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { getState, OPEN_SCENES, Scene } from "@/lib/state";
import { generateUniqueEntrants } from "@/lib/koreanNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 리허설(관리자 전용): 실제 관중 없이 가상 응모자를 투입해 프로덕션에서
// 전체 시나리오(유입→마감→추첨→추가추첨)를 시연한다.
// 가상 응모는 ip="rehearsal" 로 표식되어 선별 삭제가 가능하다.

export async function POST(req: Request) {
  if (!checkAdmin(req)) return unauthorized();

  let body: { action?: unknown; count?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const state = await getState();
  const scene = state.scene as Scene;

  if (action === "seed") {
    // 투입은 응모가 열린 씬에서만 — 실제 유입과 같은 조건이라 무대 연출도 동일하게 재현된다.
    if (!OPEN_SCENES.includes(scene)) {
      return Response.json({ ok: false, error: "closed", scene }, { status: 409 });
    }
    const count = Math.floor(Number(body.count));
    if (!Number.isFinite(count) || count < 1 || count > 500) {
      return Response.json({ ok: false, error: "invalid_count" }, { status: 422 });
    }
    // 이름 생성은 공용 모듈(테스트 샌드박스와 동일 로직), 기존 행과의 잔여 충돌은 skipDuplicates 로 흡수.
    const rows = generateUniqueEntrants(count, randomInt).map((r) => ({ ...r, ip: "rehearsal" }));
    const created = await prisma.entry.createMany({ data: rows, skipDuplicates: true });
    return Response.json({ ok: true, seeded: created.count });
  }

  if (action === "clear") {
    // 추첨이 시작된 뒤(DRAWING/WINNERS)는 당첨 명단이 뒤섞이므로 선별 삭제 금지 — 전체 리셋으로만.
    if (scene === "DRAWING" || scene === "WINNERS") {
      return Response.json({ ok: false, error: "live_locked", scene }, { status: 423 });
    }
    const deleted = await prisma.entry.deleteMany({ where: { ip: "rehearsal" } });
    return Response.json({ ok: true, deleted: deleted.count });
  }

  return Response.json({ ok: false, error: "invalid_action" }, { status: 422 });
}
