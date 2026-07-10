import { prisma } from "./prisma";

export const SCENES = ["QR", "COLLECTING", "FROZEN", "DRAWING", "WINNERS"] as const;
export type Scene = (typeof SCENES)[number];

// 허용된 전이만. 그 외는 서버가 거부(순서 강제).
const TRANSITIONS: Record<Scene, Scene[]> = {
  QR: ["COLLECTING"],
  COLLECTING: ["QR", "FROZEN"], // 마감 전엔 QR/현황 왕복 가능
  FROZEN: ["DRAWING", "COLLECTING"], // 조기 마감 실수 복구: 추첨 전이면 응모 재개 가능
  DRAWING: ["WINNERS"],
  WINNERS: ["DRAWING"], // 추가추첨 연출을 위해 되돌아갈 수 있음
};

// 응모 접수가 열려 있는 씬(마감 전).
export const OPEN_SCENES: Scene[] = ["QR", "COLLECTING"];
// 당첨자 명단을 외부에 노출해도 되는 씬(사전 유출 차단).
export const REVEAL_SCENES: Scene[] = ["DRAWING", "WINNERS"];

export function canTransition(from: Scene, to: Scene): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function getState() {
  let state = await prisma.eventState.findUnique({ where: { id: 1 } });
  if (!state) {
    try {
      state = await prisma.eventState.create({ data: { id: 1, scene: "QR" } });
    } catch {
      // 동시 초기화 경합(P2002): 다른 요청이 먼저 만들었으면 다시 읽는다.
      state = await prisma.eventState.findUniqueOrThrow({ where: { id: 1 } });
    }
  }
  return state;
}
