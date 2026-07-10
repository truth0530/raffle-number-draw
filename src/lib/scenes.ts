// 씬 상태머신의 단일 진실 — 서버(API)와 테스트 샌드박스(브라우저)가 공유하는 순수 모듈.
// 여기 규칙을 바꾸면 실제 운영과 /test 시나리오 테스트가 함께 바뀐다(일관성 보장).

export const SCENES = ["QR", "COLLECTING", "FROZEN", "DRAWING", "WINNERS"] as const;
export type Scene = (typeof SCENES)[number];

// 허용된 전이만. 그 외는 거부(순서 강제).
const TRANSITIONS: Record<Scene, Scene[]> = {
  // QR에서도 바로 마감 가능 — 리모컨의 '응모 마감' 버튼이 QR 씬에서도 노출되므로
  // COLLECTING 경유를 강제하면 버튼이 illegal_transition으로 죽는다(공유 컴포넌트 테스트로 실측).
  QR: ["COLLECTING", "FROZEN"],
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
