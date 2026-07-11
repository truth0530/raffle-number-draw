import { prisma } from "@/lib/prisma";
import { checkAdmin, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZES = ["half", "medium", "small"];
// QR은 가운데(기본) 또는 우측 상단으로만. 하단 이동 없음.
const CORNERS = ["center", "tr"];

// QR 표시 제어(관리자 전용): 표시여부/크기/위치.
export async function POST(req: Request) {
  if (!checkAdmin(req)) return unauthorized();

  let body: { visible?: unknown; size?: unknown; corner?: unknown; preview?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const data: { qrVisible?: boolean; qrSize?: string; qrCorner?: string; qrPreview?: boolean } = {};
  if (typeof body.visible === "boolean") data.qrVisible = body.visible;
  if (typeof body.size === "string" && SIZES.includes(body.size)) data.qrSize = body.size;
  if (typeof body.corner === "string" && CORNERS.includes(body.corner)) data.qrCorner = body.corner;
  if (typeof body.preview === "boolean") data.qrPreview = body.preview;

  if (Object.keys(data).length === 0) {
    return Response.json({ ok: false, error: "no_valid_fields" }, { status: 422 });
  }

  const updated = await prisma.eventState.update({ where: { id: 1 }, data });
  return Response.json({
    ok: true,
    qr: { visible: updated.qrVisible, size: updated.qrSize, corner: updated.qrCorner, preview: updated.qrPreview },
  });
}
