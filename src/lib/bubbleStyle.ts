// 버블 시각 정체성(색·이름 폰트)의 단일 진실 — 무대 항아리(JarCanvas)와
// 응모자 폰(/done)이 이 모듈을 공유한다. 응모자가 폰 화면의 내 버블과
// 무대 화면의 버블을 색으로 대조해 자기 버블을 찾는 기능의 근거이므로,
// 여기 값이 바뀌면 양쪽이 함께 바뀌어야 한다(한쪽만 바꾸면 대조가 깨진다).

export const BUBBLE_COLORS = ["#6d5cff", "#4f8cff", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb923c"];

export const BUBBLE_FONT_FAMILY = '-apple-system, "Noto Sans KR", sans-serif';
export const BUBBLE_NAME_COLOR = "rgba(255,255,255,0.96)";

export function hash01(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// 색은 entry id에서 결정적으로 파생 — 서버·무대·폰 어디서 계산해도 같다.
export function colorFor(id: string) {
  return BUBBLE_COLORS[Math.floor(hash01(id + "c") * BUBBLE_COLORS.length) % BUBBLE_COLORS.length];
}

// 버블 반지름 r에 이름(chars 글자)을 우겨넣는 폰트 크기 — 무대와 동일 공식.
export function bubbleFontSize(r: number, name: string) {
  const chars = Math.max(2, name.length);
  return Math.max(4, Math.min(r * 1.05, (r * 2 * 0.94) / (chars * 0.92)));
}
