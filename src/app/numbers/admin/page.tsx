"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NState,
  NumItem,
  Status,
  loadState,
  saveState,
  subscribe,
  subscribePresence,
  sendPresence,
  actConfig,
  actDraw,
  actReveal,
  actMark,
  actFill,
  actReset,
  defaultState,
} from "@/lib/numberStore";
import { btn as uiBtn, ghostDanger, panel as uiPanel, inputBase } from "@/lib/ui";

// 상태색 — 받음(하늘) / 없음(로즈) / 대기(앰버) / 추가(민트). 칙칙한 다크레드 대신 밝은 로즈 톤.
const C = {
  received: "#38bdf8",
  absent: "#fb7185",
  pending: "#fbbf24",
  receivedSolid: "#0284c7",
  absentSolid: "#e11d48",
} as const;

export default function NumbersAdmin() {
  const [state, setState] = useState<NState>(defaultState);
  const stateRef = useRef<NState>(defaultState);
  stateRef.current = state;
  const [rangeInput, setRangeInput] = useState("400");
  const [countInput, setCountInput] = useState("20");
  const [speedInput, setSpeedInput] = useState("1.0");
  const [mode, setMode] = useState<Status>("received");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 네이티브 confirm()/alert() 은 브라우저가 전체화면을 강제 해제한다 — 같은 브라우저의
  // 슬라이드쇼(2번 모니터) 전체화면이 추첨 시작/리셋 때마다 풀리는 버그의 원인. 대신
  // 페이지 안(React) 모달로 확인받으면 전체화면이 유지된다.
  const [confirmBox, setConfirmBox] = useState<{ msg: string; onOk: () => void } | null>(null);
  const [alertBox, setAlertBox] = useState<string | null>(null);
  const askConfirm = useCallback((msg: string, onOk: () => void) => setConfirmBox({ msg, onOk }), []);
  // 슬라이드쇼(무대) 창 상태 — 하트비트로 열림 여부 감지(관리자 새로고침 후에도 정확).
  const [showOpen, setShowOpen] = useState(false);
  const [previewOn, setPreviewOn] = useState(true);
  const showWinRef = useRef<Window | null>(null);
  const lastAliveRef = useRef(0);

  useEffect(() => {
    const unsub = subscribePresence((m) => {
      if (m.type === "show-alive") {
        lastAliveRef.current = Date.now();
        setShowOpen(true);
      } else if (m.type === "show-bye") {
        lastAliveRef.current = 0;
        setShowOpen(false);
      }
    });
    // 열림 판정 이중화:
    // (1) 내가 연 창 참조(showWinRef) — 새로고침 전이면 백그라운드 탭 타이머 스로틀링과
    //     무관하게 즉시·확실. closed 가 되면 닫힘.
    // (2) 하트비트(lastAlive) — 관리자 새로고침으로 참조가 사라진 뒤의 폴백.
    // 둘 중 하나라도 살아있으면 열림.
    const tick = setInterval(() => {
      const refAlive = !!showWinRef.current && !showWinRef.current.closed;
      if (!refAlive) showWinRef.current = null;
      const beatAlive = !!lastAliveRef.current && Date.now() - lastAliveRef.current <= 4000;
      if (!beatAlive) lastAliveRef.current = 0;
      setShowOpen(refAlive || beatAlive);
    }, 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

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

  const beginDraw = useCallback(() => {
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

  const startDraw = useCallback(() => {
    askConfirm("새로 추첨합니다(기존 초기화). 진행할까요?", beginDraw);
  }, [askConfirm, beginDraw]);

  function openShow() {
    // 이미 열려 있으면(하트비트 감지) 새 창을 열지 않는다 — 이중 창 방지.
    // 이 관리자가 연 창 참조가 있으면 앞으로 가져오고, (관리자 새로고침 등으로) 참조가
    // 없으면 프레즌스 채널로 focus 요청을 보내 그 창이 스스로 앞으로 나온다.
    if (showOpen) {
      if (showWinRef.current && !showWinRef.current.closed) {
        showWinRef.current.focus();
      } else {
        sendPresence({ type: "focus-show" });
        setAlertBox("슬라이드쇼 창은 이미 열려 있습니다. (아래 미리보기로 상태를 확인하세요)");
      }
      return;
    }
    const w = window.open(
      "/numbers/show",
      "raffle_show",
      "popup=yes,width=1400,height=900,left=120,top=80,toolbar=no,menubar=no,location=no,status=no,scrollbars=no,resizable=yes"
    );
    // 팝업 차단 시 무반응으로 끝나지 않게(네이티브 alert 은 전체화면을 깨므로 페이지 모달로).
    if (!w) setAlertBox("팝업이 차단되었습니다. 브라우저 팝업을 허용하거나 주소창에 /numbers/show 를 직접 입력하세요.");
    else showWinRef.current = w;
  }

  const numbers = state.numbers;
  const main = numbers.filter((it) => it.status !== "absent").sort((a, b) => a.n - b.n);
  const absent = numbers.filter((it) => it.status === "absent").sort((a, b) => a.n - b.n);
  const received = numbers.filter((it) => it.status === "received").length;
  const pending = numbers.filter((it) => it.status === "pending").length;

  return (
    <main style={wrap}>
      {/* 상단 바 — 제목·집계·창 열기·리셋을 한 줄에 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={h1}>번호 추첨 관리자</h1>
        <div style={{ display: "flex", gap: 12, fontSize: 13, opacity: 0.85, flex: 1, minWidth: 180 }}>
          <span>받음 <b style={{ color: C.received }}>{received}</b></span>
          <span>없음 <b style={{ color: C.absent }}>{absent.length}</b></span>
          <span>대기 <b style={{ color: C.pending }}>{pending}</b></span>
        </div>
        <button
          style={{ ...uiBtn(showOpen ? "green" : "sky", { size: "sm" }), width: "auto", whiteSpace: "nowrap" }}
          onClick={openShow}
        >
          {showOpen ? "슬라이드쇼 열림 · 앞으로" : "슬라이드쇼 창 열기"}
        </button>
        <button
          style={{ ...ghostDanger, width: "auto", padding: "9px 12px", fontSize: 13.5, whiteSpace: "nowrap" }}
          onClick={() => askConfirm("전체 초기화할까요?", () => update(actReset))}
        >
          전체 리셋
        </button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.45, margin: "4px 0 0" }}>
        슬라이드쇼 창을 프로젝터로 옮겨 클릭하면 전체화면 · 같은 번호를 다시 탭하면 대기로 되돌아갑니다.
      </p>

      {/* 설정 + 실행 — 한 줄 컨트롤 바 */}
      <div style={{ ...uiPanel, marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={label}>번호 1~</span>
        <input value={rangeInput} onChange={(e) => setRangeInput(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" style={{ ...input, width: 76 }} />
        <span style={label}>뽑기</span>
        <input value={countInput} onChange={(e) => setCountInput(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" style={{ ...input, width: 58 }} />
        <span style={label}>개 · 속도</span>
        <input value={speedInput} onChange={(e) => setSpeedInput(e.target.value.replace(/[^0-9.]/g, "").slice(0, 4))} inputMode="decimal" style={{ ...input, width: 56 }} />
        <span style={label}>초/개</span>
        <button
          style={applyBtn}
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
        <span style={{ ...label, opacity: 0.4 }}>
          1~{state.rangeMax} 중 {state.drawCount}개 · 총 {((state.drawCount * state.revealMs) / 1000).toFixed(0)}초
        </span>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...uiBtn(state.drawing ? "slate" : "violet"), width: "auto", minWidth: 130, whiteSpace: "nowrap" }}
          onClick={startDraw}
          disabled={state.drawing}
        >
          {state.drawing ? `추첨 중 ${numbers.length}/${state.drawCount}` : "추첨 시작"}
        </button>
        <button
          style={{ ...uiBtn(absent.length > 0 ? "green" : "slate"), width: "auto", minWidth: 96, whiteSpace: "nowrap" }}
          onClick={() => update(actFill)}
          disabled={absent.length === 0 || state.drawing}
        >
          채우기{absent.length > 0 ? ` ${absent.length}` : ""}
        </button>
      </div>

      {/* 탭 모드 — 받음/없음 둘뿐. 해제는 같은 번호 재탭으로. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <span style={label}>번호를 탭하면</span>
        <button style={modeBtn(mode === "received", C.receivedSolid)} onClick={() => setMode("received")}>받음</button>
        <button style={modeBtn(mode === "absent", C.absentSolid)} onClick={() => setMode("absent")}>없음</button>
        <span style={{ ...label, opacity: 0.4 }}>으로 표시</span>
      </div>

      {/* 번호 그리드 — 남는 세로 공간을 모두 사용, 페이지 스크롤 없음 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 12 }}>
        {main.length === 0 && !state.drawing ? (
          <div style={{ opacity: 0.45, fontSize: 14 }}>추첨 전입니다.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(66px, 1fr))", gap: 8 }}>
            {main.map((it) => (
              <button key={it.n} onClick={() => update((s) => actMark(s, it.n, mode))} style={chip(it)}>
                {it.n}
                {it.status === "received" && <span style={{ position: "absolute", top: 2, right: 5, fontSize: 11, color: C.received }}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 없음 보관함 — 취소선 없이 로즈 톤, 탭하면 대기로 복귀 */}
      {absent.length > 0 && (
        <div style={tray}>
          <div style={trayTitle}>없음 · 교체 대기 {absent.length} — 탭하면 대기로 복귀</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {absent.map((it) => (
              <button key={it.n} onClick={() => update((s) => actMark(s, it.n, "absent"))} style={trayChip}>
                {it.n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 발표자 모드 미리보기 — 청중이 보는 슬라이드쇼 화면을 관리자 화면에 그대로 축소 표시.
          /numbers/show?preview=1 을 iframe 으로 띄워 같은 상태(localStorage)를 실시간 미러링.
          preview 모드라 하트비트를 안 보내 "쇼 열림" 오판을 만들지 않는다. */}
      <div style={pipWrap}>
        <div style={pipHeader}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: showOpen ? "#22c55e" : "#6b7280",
                boxShadow: showOpen ? "0 0 6px #22c55e" : "none",
              }}
            />
            청중 화면 {showOpen ? "· 무대 열림" : "· 무대 창 닫힘"}
          </span>
          <button
            onClick={() => setPreviewOn((v) => !v)}
            style={{ padding: "3px 9px", fontSize: 12, fontWeight: 700, borderRadius: 7, border: "1px solid #2e2e3a", background: "#20202a", color: "#e4e4ec", cursor: "pointer" }}
          >
            {previewOn ? "접기" : "펼치기"}
          </button>
        </div>
        {previewOn && (
          <div style={{ width: PREVIEW_W, height: PREVIEW_W * (720 / 1280), overflow: "hidden", position: "relative", background: "#0a0a0f" }}>
            <iframe
              src="/numbers/show?preview=1"
              title="청중 화면 미리보기"
              style={{
                width: 1280,
                height: 720,
                border: 0,
                transform: `scale(${PREVIEW_W / 1280})`,
                transformOrigin: "top left",
                pointerEvents: "none",
              }}
            />
            {!showOpen && (
              <div style={pipClosedOverlay}>
                무대 창이 닫혀 있습니다
                <br />
                <span style={{ opacity: 0.7, fontWeight: 600, fontSize: 11.5 }}>위 “슬라이드쇼 창 열기”를 누르세요</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 페이지 내 확인 모달 — 네이티브 confirm 대체(전체화면 유지) */}
      {confirmBox && (
        <div style={modalBackdrop} onClick={() => setConfirmBox(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.5 }}>{confirmBox.msg}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                style={{ ...uiBtn("slate"), flex: 1 }}
                onClick={() => setConfirmBox(null)}
              >
                취소
              </button>
              <button
                style={{ ...uiBtn("violet"), flex: 1 }}
                onClick={() => {
                  const fn = confirmBox.onOk;
                  setConfirmBox(null);
                  fn();
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 페이지 내 알림 모달 — 네이티브 alert 대체(전체화면 유지) */}
      {alertBox && (
        <div style={modalBackdrop} onClick={() => setAlertBox(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.55 }}>{alertBox}</div>
            <button style={{ ...uiBtn("violet"), width: "100%", marginTop: 20 }} onClick={() => setAlertBox(null)}>
              확인
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

const wrap: React.CSSProperties = {
  height: "100dvh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  maxWidth: 980,
  margin: "0 auto",
  padding: "14px 20px 16px",
  color: "#f5f5f7",
};
const h1: React.CSSProperties = { fontSize: 19, fontWeight: 800, whiteSpace: "nowrap" };
const label: React.CSSProperties = { fontSize: 13.5, opacity: 0.65, whiteSpace: "nowrap" };
const input: React.CSSProperties = { ...inputBase, padding: "9px 10px", fontSize: 15 };
const applyBtn: React.CSSProperties = {
  padding: "9px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  borderRadius: 9,
  border: "1px solid rgba(109,92,255,0.45)",
  background: "rgba(109,92,255,0.14)",
  color: "#c9c2ff",
  cursor: "pointer",
};
function modeBtn(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "10px 26px",
    fontSize: 14.5,
    fontWeight: 700,
    borderRadius: 9,
    border: active ? "1px solid transparent" : "1px solid #2a2a35",
    background: active ? color : "transparent",
    color: active ? "#fff" : "#a8a8b6",
    cursor: "pointer",
  };
}
// 번호표 칩 — 색 틴트로만 구분(취소선 없음): 대기(앰버) / 받음(하늘) / 없음(로즈) / 추가(민트)
function chip(it: NumItem): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "relative",
    padding: "13px 4px",
    fontSize: 20,
    fontWeight: 700,
    borderRadius: 10,
    cursor: "pointer",
  };
  if (it.status === "absent")
    return { ...base, background: "rgba(244,63,94,0.1)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.45)" };
  if (it.status === "received")
    return { ...base, background: "rgba(56,189,248,0.1)", color: "#7dd3fc", border: "1px solid rgba(56,189,248,0.5)" };
  if (it.added)
    return { ...base, background: "rgba(52,211,153,0.1)", color: "#6ee7b7", border: "1px solid rgba(52,211,153,0.5)" };
  return { ...base, background: "rgba(251,191,36,0.07)", color: "#fcd34d", border: "1px solid rgba(251,191,36,0.3)" };
}
const tray: React.CSSProperties = {
  marginTop: 10,
  padding: 12,
  borderRadius: 12,
  background: "rgba(244,63,94,0.05)",
  border: "1px solid rgba(244,63,94,0.28)",
};
const trayTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: C.absent, marginBottom: 8 };
const trayChip: React.CSSProperties = {
  minWidth: 64,
  padding: "11px 14px",
  fontSize: 20,
  fontWeight: 700,
  borderRadius: 10,
  background: "rgba(244,63,94,0.12)",
  color: "#fda4af",
  border: "1px solid rgba(244,63,94,0.4)",
  cursor: "pointer",
};
// 발표자 미리보기(PiP) — 화면 우하단 고정. 번호 그리드를 가리면 "접기"로 숨긴다.
const PREVIEW_W = 480;
const pipWrap: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 40,
  width: PREVIEW_W,
  maxWidth: "calc(100vw - 32px)",
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid #2e2e3a",
  background: "#15151d",
  boxShadow: "0 12px 34px rgba(0,0,0,0.55)",
};
const pipHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 10px",
  background: "#1b1b25",
  color: "#e4e4ec",
};
const pipClosedOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: 4,
  background: "rgba(10,10,15,0.78)",
  color: "#c9c2ff",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.5,
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};
const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  padding: "24px 22px",
  borderRadius: 16,
  background: "#15151d",
  border: "1px solid #2a2a35",
  color: "#f5f5f7",
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
};
