// 공용 UI 토큰 — 관리자·입구 화면의 버튼/패널/입력을 한 곳에서 일관되게.
// (무대·슬라이드쇼 등 연출 화면은 각자 전용 스타일 유지)

import type { CSSProperties } from "react";

// 팔레트: [윗면(밝음), 아랫면(어두움), 테두리 원색]
const PALETTE = {
  violet: ["#7a68ff", "#5847e6", "#9f92ff"],
  green: ["#0eaf7c", "#047857", "#34d399"],
  orange: ["#ea6a1a", "#c2410c", "#fb923c"],
  slate: ["#3f3f4f", "#2c2c38", "#6b6b82"],
  red: ["#a51d1d", "#7f1d1d", "#dc2626"],
  navy: ["#27507f", "#1e3a5f", "#4b90d6"],
  indigo: ["#5b54ee", "#4338ca", "#818cf8"],
  sky: ["#0ea5e9", "#0369a1", "#38bdf8"],
} as const;
export type Tone = keyof typeof PALETTE;

export function btn(tone: Tone, opts: { size?: "sm" | "md" | "lg" } = {}): CSSProperties {
  const [top, bottom, edge] = PALETTE[tone];
  const size = opts.size ?? "md";
  return {
    padding: size === "lg" ? "15px 16px" : size === "sm" ? "9px 10px" : "12px 14px",
    fontSize: size === "lg" ? 16.5 : size === "sm" ? 13.5 : 15,
    fontWeight: 800,
    borderRadius: 12,
    border: `1px solid ${edge}55`,
    background: `linear-gradient(180deg, ${top}, ${bottom})`,
    color: "#fff",
    cursor: "pointer",
    width: "100%",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16), 0 3px 10px rgba(0,0,0,0.35)",
    textShadow: "0 1px 2px rgba(0,0,0,0.35)",
  };
}

// 토글형 알약 버튼(선택지 행) — active 시 보라 하이라이트.
export function chip(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "9px 6px",
    fontSize: 13.5,
    fontWeight: 700,
    borderRadius: 10,
    border: active ? "1px solid #9f92ff" : "1px solid #2a2a38",
    background: active ? "linear-gradient(180deg,#372f6e,#2a2555)" : "#181822",
    color: active ? "#fff" : "#c7c7d4",
    cursor: "pointer",
    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.12)" : "none",
  };
}

// 위험 동작(리셋 등) — 평소엔 조용한 고스트, 누르기 전까지 시선을 끌지 않음.
export const ghostDanger: CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  fontSize: 14,
  fontWeight: 700,
  borderRadius: 12,
  border: "1px solid #7f1d1d88",
  background: "rgba(127,29,29,0.16)",
  color: "#fca5a5",
  cursor: "pointer",
};

export const panel: CSSProperties = {
  padding: 12,
  borderRadius: 14,
  background: "#13131c",
  border: "1px solid #23232f",
};

export const panelTitle: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 800,
  letterSpacing: 1.2,
  opacity: 0.55,
  marginBottom: 8,
};

export const inputBase: CSSProperties = {
  padding: "11px 12px",
  fontSize: 16,
  borderRadius: 10,
  border: "1px solid #2a2a38",
  background: "#181822",
  color: "#fff",
  outline: "none",
};
