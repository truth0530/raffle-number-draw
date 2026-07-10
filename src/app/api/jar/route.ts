import { prisma } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 추첨 항아리 제어(관리자): 코르크 개폐 + 흔들기.
export async function POST(req: Request) {
  if (!checkAdmin(req)) return unauthorized();

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const b = body as { action?: unknown; value?: unknown; delta?: unknown };
  const action = String(b.action ?? "");
  if (action === "openCork") {
    await prisma.eventState.update({ where: { id: 1 }, data: { corkOpen: true } });
  } else if (action === "closeCork") {
    await prisma.eventState.update({ where: { id: 1 }, data: { corkOpen: false } });
  } else if (action === "shake") {
    await prisma.eventState.update({ where: { id: 1 }, data: { shakeAt: new Date() } });
  } else if (action === "setDuration") {
    const v = Math.max(5, Math.min(180, Math.floor(Number(b.value))));
    if (!Number.isFinite(v)) return Response.json({ ok: false, error: "invalid_value" }, { status: 422 });
    await prisma.eventState.update({ where: { id: 1 }, data: { drawDuration: v } });
  } else if (action === "tilt") {
    const d = Number(b.delta);
    if (!Number.isFinite(d)) return Response.json({ ok: false, error: "invalid_delta" }, { status: 422 });
    const cur = await prisma.eventState.findUnique({ where: { id: 1 } });
    const next = Math.max(-60, Math.min(60, (cur?.tiltDeg ?? 0) + d));
    await prisma.eventState.update({ where: { id: 1 }, data: { tiltDeg: next } });
  } else if (action === "resetTilt") {
    await prisma.eventState.update({ where: { id: 1 }, data: { tiltDeg: 0 } });
  } else {
    return Response.json({ ok: false, error: "invalid_action" }, { status: 422 });
  }
  return Response.json({ ok: true });
}
