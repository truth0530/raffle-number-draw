// 공용 UI 토큰 — 관리자·입구 화면의 버튼/패널/입력을 한 곳에서 일관되게.
// 디자인 언어: 플랫 단색. 그라데이션·광택·그림자 없이 색·여백·타이포로만 위계를 만든다.
// (무대·슬라이드쇼 등 연출 화면은 각자 전용 스타일 유지)

import type { CSSProperties } from "react";

// 톤: 배경 / 글자 / 테두리. slate만 중립 서피스(테두리로 구분), 나머지는 단색 채움.
const TONES = {
  violet: { bg: "#6d5cff", fg: "#ffffff", bd: "transparent" },
  green: { bg: "#059669", fg: "#ffffff", bd: "transparent" },
  orange: { bg: "#c2410c", fg: "#ffffff", bd: "transparent" },
  slate: { bg: "#20202a", fg: "#e4e4ec", bd: "#2e2e3a" },
  red: { bg: "#b91c1c", fg: "#ffffff", bd: "transparent" },
  navy: { bg: "#1e3a5f", fg: "#dbeafe", bd: "transparent" },
  indigo: { bg: "#4f46e5", fg: "#ffffff", bd: "transparent" },
  sky: { bg: "#0284c7", fg: "#ffffff", bd: "transparent" },
} as const;
export type Tone = keyof typeof TONES;

export function btn(tone: Tone, opts: { size?: "sm" | "md" | "lg" } = {}): CSSProperties {
  const t = TONES[tone];
  const size = opts.size ?? "md";
  return {
    padding: size === "lg" ? "14px 16px" : size === "sm" ? "9px 12px" : "12px 14px",
    fontSize: size === "lg" ? 16 : size === "sm" ? 13.5 : 15,
    fontWeight: 700,
    borderRadius: 10,
    border: `1px solid ${t.bd}`,
    background: t.bg,
    color: t.fg,
    cursor: "pointer",
    width: "100%",
  };
}

// 토글형 알약 버튼(선택지 행) — active 시 보라 틴트.
export function chip(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "9px 6px",
    fontSize: 13.5,
    fontWeight: 600,
    borderRadius: 9,
    border: active ? "1px solid rgba(109,92,255,0.55)" : "1px solid #2a2a35",
    background: active ? "rgba(109,92,255,0.16)" : "transparent",
    color: active ? "#c9c2ff" : "#a8a8b6",
    cursor: "pointer",
  };
}

// 위험 동작(리셋 등) — 평소엔 조용한 고스트, 누르기 전까지 시선을 끌지 않음.
export const ghostDanger: CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 10,
  border: "1px solid rgba(127,29,29,0.5)",
  background: "rgba(185,28,28,0.08)",
  color: "#f87171",
  cursor: "pointer",
};

export const panel: CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "#12121a",
  border: "1px solid #22222c",
};

export const panelTitle: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: 1.2,
  opacity: 0.5,
  marginBottom: 8,
};

export const inputBase: CSSProperties = {
  padding: "11px 12px",
  fontSize: 16,
  borderRadius: 10,
  border: "1px solid #2a2a35",
  background: "#14141c",
  color: "#fff",
  outline: "none",
};
