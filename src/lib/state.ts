import { prisma } from "./prisma";

// 상태머신 규칙은 scenes.ts(순수 모듈)가 단일 진실 — 테스트 샌드박스와 공유.
export { SCENES, OPEN_SCENES, REVEAL_SCENES, canTransition } from "./scenes";
export type { Scene } from "./scenes";

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
