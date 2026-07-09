import { timingSafeEqual } from "crypto";

// 관리자 토큰 검증(상수시간 비교). 변경 요청(scene/draw/reset)에만 사용.
export function checkAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_TOKEN ?? "";
  const got = req.headers.get("x-admin-token") ?? "";
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
