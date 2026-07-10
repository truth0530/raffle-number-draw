"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NState,
  NumItem,
  Status,
  loadState,
  saveState,
  subscribe,
  actConfig,
  actDraw,
  actReveal,
  actMark,
  actFill,
  actReset,
  defaultState,
} from "@/lib/numberStore";
import { btn as uiBtn, ghostDanger, panel as uiPanel, panelTitle, inputBase } from "@/lib/ui";

export default function NumbersAdmin() {
  const [state, setState] = useState<NState>(defaultState);
  const stateRef = useRef<NState>(defaultState);
  stateRef.current = state;
  const [rangeInput, setRangeInput] = useState("400");
  const [countInput, setCountInput] = useState("20");
  const [speedInput, setSpeedInput] = useState("1.0");
  const [mode, setMode] = useState<Status>("received");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const s = loadState();
    setState(s);
    setRangeInput(String(s.rangeMax));
    setCountInput(String(s.drawCount));
    setSpeedInput((s.revealMs / 1000).toString());
    const unsub = subscribe(setState);
    return () => {
      unsub();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const update = useCallback((fn: (s: NState) => NState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
    saveState(next);
  }, []);

  const startDraw = useCallback(() => {
    if (!confirm("새로 추첨합니다(기존 초기화). 진행할까요?")) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    update(actDraw);
    const ms = Math.max(150, stateRef.current.revealMs || 1000);
    timerRef.current = setInterval(() => {
      update(actReveal);
      if (!stateRef.current.drawing && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, ms);
  }, [update]);

  function openShow() {
    window.open(
      "/numbers/show",
      "raffle_show",
      "popup=yes,width=1400,height=900,left=120,top=80,toolbar=no,menubar=no,location=no,status=no,scrollbars=no,resizable=yes"
    );
  }

  const numbers = state.numbers;
  const main = numbers.filter((it) => it.status !== "absent").sort((a, b) => a.n - b.n);
  const absent = numbers.filter((it) => it.status === "absent").sort((a, b) => a.n - b.n);
  const received = numbers.filter((it) => it.status === "received").length;
  const pending = numbers.filter((it) => it.status === "pending").length;

  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ ...h1, flex: 1, minWidth: 200 }}>번호 추첨 관리자</h1>
        <button style={{ ...uiBtn("sky", { size: "sm" }), width: "auto", whiteSpace: "nowrap" }} onClick={openShow}>
          슬라이드쇼 창 열기 ↗
        </button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.45, marginTop: 4 }}>
        슬라이드쇼 창을 프로젝터 모니터로 옮기고 클릭하면 전체화면이 됩니다.
      </p>

      <div style={panel}>
        <div style={panelTitle}>추첨 설정</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, opacity: 0.7 }}>번호 1~</span>
          <input value={rangeInput} onChange={(e) => setRangeInput(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" style={{ ...input, width: 84, marginTop: 0 }} />
          <span style={{ fontSize: 14, opacity: 0.7 }}>뽑기</span>
          <input value={countInput} onChange={(e) => setCountInput(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" style={{ ...input, width: 66, marginTop: 0 }} />
          <span style={{ fontSize: 14, opacity: 0.7 }}>개</span>
          <span style={{ fontSize: 14, opacity: 0.7 }}>속도</span>
          <input value={speedInput} onChange={(e) => setSpeedInput(e.target.value.replace(/[^0-9.]/g, "").slice(0, 4))} inputMode="decimal" style={{ ...input, width: 60, marginTop: 0 }} />
          <span style={{ fontSize: 14, opacity: 0.7 }}>초/개</span>
          <button
            style={mini()}
            onClick={() =>
              update((s) =>
                actConfig(s, {
                  rangeMax: Math.max(1, parseInt(rangeInput || "400", 10)),
                  drawCount: Math.max(1, parseInt(countInput || "20", 10)),
                  revealMs: Math.max(100, Math.round((parseFloat(speedInput) || 1) * 1000)),
                })
              )
            }
          >
            적용
          </button>
        </div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 8 }}>
          현재 1~{state.rangeMax} 중 {state.drawCount}개 · {(state.revealMs / 1000).toFixed(1)}초/개 · 총 {((state.drawCount * state.revealMs) / 1000).toFixed(0)}초
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button style={{ ...uiBtn(state.drawing ? "slate" : "violet", { size: "lg" }), flex: 1 }} onClick={startDraw} disabled={state.drawing}>
          {state.drawing ? `추첨 중… (${numbers.length}/${state.drawCount})` : "추첨 시작"}
        </button>
        <button style={{ ...uiBtn(absent.length > 0 ? "green" : "slate", { size: "lg" }), flex: 1 }} onClick={() => update(actFill)} disabled={absent.length === 0 || state.drawing}>
          채우기 {absent.length > 0 ? `(없음 ${absent.length}개 대체)` : ""}
        </button>
      </div>

      <div style={{ marginTop: 16, fontSize: 13, opacity: 0.6, marginBottom: 6 }}>탭 동작 선택 → 번호를 연타해 표시</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={modeBtn(mode === "received", "#2563eb")} onClick={() => setMode("received")}>받음 ✓</button>
        <button style={modeBtn(mode === "absent", "#dc2626")} onClick={() => setMode("absent")}>없음 ✗</button>
        <button style={modeBtn(mode === "pending", "#6b7280")} onClick={() => setMode("pending")}>대기(해제)</button>
      </div>
      <div style={{ fontSize: 13, opacity: 0.65, marginTop: 10 }}>
        받음 <b style={{ color: "#60a5fa" }}>{received}</b> · 없음 <b style={{ color: "#f87171" }}>{absent.length}</b> · 대기 <b style={{ color: "#ffd24a" }}>{pending}</b>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))", gap: 10, marginTop: 12 }}>
        {main.map((it) => (
          <button key={it.n} onClick={() => update((s) => actMark(s, it.n, mode))} style={chip(it)}>
            {it.n}
            {it.status === "received" && <span style={{ position: "absolute", top: 2, right: 6, fontSize: 12, color: "#60a5fa" }}>✓</span>}
          </button>
        ))}
      </div>
      {main.length === 0 && !state.drawing && <div style={{ opacity: 0.5, marginTop: 12 }}>추첨 전입니다.</div>}

      {absent.length > 0 && (
        <div style={{ marginTop: 18, padding: 14, borderRadius: 14, background: "rgba(180,30,40,0.12)", border: "1px solid rgba(255,90,90,0.35)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f87171", marginBottom: 10 }}>
            없음 · 교체 대기 ({absent.length}) — 번호를 탭하면 현재 모드로 되돌림
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))", gap: 10 }}>
            {absent.map((it) => (
              <button key={it.n} onClick={() => update((s) => actMark(s, it.n, mode))} style={chip(it)}>
                {it.n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 26, borderTop: "1px solid #222", paddingTop: 14 }}>
        <button style={ghostDanger} onClick={() => { if (confirm("전체 초기화할까요?")) update(actReset); }}>전체 리셋</button>
      </div>
      <p style={{ marginTop: 10, fontSize: 12, opacity: 0.4 }}>표출 화면: /numbers/show · 서버 없이 이 브라우저 안에서만 동기화됩니다.</p>
    </main>
  );
}

const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 20, minHeight: "100dvh", color: "#f5f5f7" };
const h1: React.CSSProperties = { fontSize: 22, fontWeight: 800 };
const input: React.CSSProperties = { ...inputBase, padding: "10px 12px" };
const panel: React.CSSProperties = { ...uiPanel, marginTop: 14 };
function mini(): React.CSSProperties {
  return { padding: "10px 14px", fontSize: 14, fontWeight: 700, borderRadius: 10, border: "1px solid #9f92ff88", background: "linear-gradient(180deg,#372f6e,#2a2555)", color: "#fff", cursor: "pointer" };
}
function modeBtn(active: boolean, color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "13px",
    fontSize: 15.5,
    fontWeight: 800,
    borderRadius: 12,
    border: active ? `2px solid ${color}` : "2px solid #2a2a35",
    background: active ? `linear-gradient(180deg, ${color}, ${color}cc)` : "#1a1a24",
    color: active ? "#fff" : "#c7c7d4",
    cursor: "pointer",
    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 3px 10px rgba(0,0,0,0.3)" : "none",
  };
}
// 번호표 칩 — 실물 번호표처럼: 대기(금색 티켓) / 받음(파랑 확정) / 없음(빨강 취소선)
function chip(it: NumItem): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "relative",
    padding: "14px 4px",
    fontSize: 22,
    fontWeight: 900,
    borderRadius: 12,
    cursor: "pointer",
    border: "1px solid #2a2a35",
    boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
  };
  if (it.status === "absent")
    return { ...base, background: "linear-gradient(180deg, rgba(190,40,50,0.35), rgba(140,25,35,0.3))", color: "#fecaca", border: "2px solid #ef4444", textDecoration: "line-through", textDecorationThickness: 2.5 };
  if (it.status === "received")
    return { ...base, background: "linear-gradient(180deg,#2b3b66,#1e293b)", color: "#dbeafe", border: "2px solid #3b82f6" };
  if (it.added)
    return { ...base, background: "linear-gradient(180deg,#1c6b3c,#14532d)", color: "#bbf7d0", border: "2px solid #4ade80" };
  return { ...base, background: "linear-gradient(180deg,#2a2618,#1c1a12)", color: "#ffd24a", border: "1px solid #ffd24a44" };
}
