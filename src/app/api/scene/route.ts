import { prisma } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { getState, canTransition, SCENES, Scene } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 씬 전이(관리자 전용). 상태머신이 순서를 강제.
export async function POST(req: Request) {
  if (!checkAdmin(req)) return unauthorized();

  let body: { to?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const to = String(body.to ?? "") as Scene;
  if (!SCENES.includes(to)) {
    return Response.json({ ok: false, error: "invalid_scene" }, { status: 422 });
  }

  const state = await getState();
  const from = state.scene as Scene;

  if (from === to) {
    return Response.json({ ok: true, scene: to, noop: true });
  }
  if (!canTransition(from, to)) {
    return Response.json(
      { ok: false, error: "illegal_transition", from, to },
      { status: 409 }
    );
  }

  const updated = await prisma.eventState.update({
    where: { id: 1 },
    data: {
      scene: to,
      // 마감 취소(FROZEN→COLLECTING)면 마감 시각도 지운다.
      frozenAt: to === "FROZEN" ? new Date() : to === "COLLECTING" ? null : state.frozenAt,
    },
  });

  return Response.json({ ok: true, scene: updated.scene });
}
