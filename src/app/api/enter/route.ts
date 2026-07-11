import { prisma } from "@/lib/prisma";
import { getState, OPEN_SCENES, Scene } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 매우 관대한 IP 가드: 현장 wifi는 NAT로 수백 명이 IP 1개를 공유하므로
// 정상 사용자를 막지 않도록 느슨하게 두고, 폭주 봇만 차단한다.
// 400명이 QR 공개 직후 1~2분에 몰려도(같은 NAT IP) 걸리지 않을 한도.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 1200;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // 무한 성장 방지: 커지면 만료된 IP 버킷을 일괄 정리.
  if (hits.size > 2000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

function normalizeName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLast4(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 4 ? digits : null;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: { name?: unknown; last4?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const name = normalizeName(body.name);
  const last4 = normalizeLast4(body.last4);

  if (name.length < 1 || name.length > 40) {
    return Response.json({ ok: false, error: "invalid_name" }, { status: 422 });
  }
  if (!last4) {
    return Response.json({ ok: false, error: "invalid_last4" }, { status: 422 });
  }

  // 마감(FROZEN) 이후에는 접수 거부.
  const state = await getState();
  if (!OPEN_SCENES.includes(state.scene as Scene)) {
    return Response.json({ ok: false, error: "closed" }, { status: 409 });
  }

  try {
    const created = await prisma.entry.create({ data: { name, last4, ip } });
    // entryId: 응모자 폰이 자기 당첨 여부를 확인(응모 완료 화면)하는 열쇠.
    return Response.json({ ok: true, duplicate: false, entryId: created.id });
  } catch (e: unknown) {
    // P2002 = unique(name,last4) 위반 → 이미 응모로 간주(멱등). 충돌은 로그로 남겨 당일 수동 판별.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      await prisma.collisionLog.create({ data: { name, last4, ip } }).catch(() => {});
      // P2002는 행이 반드시 존재함을 보장한다 — findUnique가 null이면 일시적 오류이므로 한 번 재시도.
      // entryId가 null로 저장되면 폰의 당첨 매칭이 이름+번호 폴백에 의존하게 돼(교차 이벤트
      // 유령 당첨 위험), 여기서 확실한 id를 확보하는 것이 정합성의 근원 방어다.
      const lookup = () =>
        prisma.entry
          .findUnique({ where: { name_last4: { name, last4 } }, select: { id: true } })
          .catch(() => null);
      const existing = (await lookup()) ?? (await lookup());
      return Response.json({ ok: true, duplicate: true, entryId: existing?.id ?? null });
    }
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
