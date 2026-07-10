import { prisma } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { getState, Scene } from "@/lib/state";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 리셋(파괴적): 스냅샷 먼저 → 전량 삭제 → 씬 QR 초기화.
// 안전장치: 토큰 + confirm:"RESET" + 라이브 잠금(DRAWING/WINNERS 중엔 force:true 필요).
export async function POST(req: Request) {
  if (!checkAdmin(req)) return unauthorized();

  let body: { confirm?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (body.confirm !== "RESET") {
    return Response.json({ ok: false, error: "confirm_required" }, { status: 400 });
  }

  const state = await getState();
  const live = state.scene === "DRAWING" || state.scene === "WINNERS";
  if (live && body.force !== true) {
    // 라이브(추첨 중/후) 오리셋 방지: 명시적 force 필요.
    return Response.json(
      { ok: false, error: "live_locked", scene: state.scene as Scene },
      { status: 423 }
    );
  }

  // 1) 스냅샷 먼저 — 데이터가 진짜로 소실되지 않게.
  const [entries, winners, collisions] = await Promise.all([
    prisma.entry.findMany(),
    prisma.winner.findMany({ include: { entry: true, draw: true } }),
    prisma.collisionLog.findMany(),
  ]);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshot = { at: new Date().toISOString(), scene: state.scene, entries, winners, collisions };
  const payload = JSON.stringify(snapshot, null, 2);
  // 스냅샷 파일은 best-effort: Vercel 서버리스는 cwd가 읽기전용이라 /tmp로 폴백.
  // 파일 실패가 리셋을 막으면 안 된다(스냅샷 요약은 응답에 항상 포함).
  let file = "(file-skipped)";
  for (const dir of [path.join(process.cwd(), "backups"), "/tmp/raffle-backups"]) {
    try {
      await mkdir(dir, { recursive: true });
      const f = path.join(dir, `reset-${stamp}.json`);
      await writeFile(f, payload, "utf8");
      file = f;
      break;
    } catch {
      /* 다음 경로 시도 */
    }
  }

  // 2) 전량 삭제 + 씬 초기화 (원자적).
  await prisma.$transaction([
    prisma.winner.deleteMany(),
    prisma.draw.deleteMany(),
    prisma.entry.deleteMany(),
    prisma.collisionLog.deleteMany(),
    prisma.eventState.update({
      where: { id: 1 },
      data: { scene: "QR", frozenAt: null, qrVisible: true, qrSize: "half", qrCorner: "center", corkOpen: false, shakeAt: null, tiltDeg: 0 },
    }),
  ]);

  // 스냅샷 원본을 응답에도 실어 보낸다 — 서버리스에선 /tmp 파일이 곧 증발하므로
  // 관리자 브라우저가 이걸 받아 로컬 파일로 저장하는 것이 실질적 백업이다.
  return Response.json({
    ok: true,
    snapshot: path.basename(file),
    snapshotData: snapshot,
    cleared: { entries: entries.length, winners: winners.length },
  });
}
