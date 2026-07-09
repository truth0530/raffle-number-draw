"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State = {
  ok: boolean;
  scene: string;
  entryCount: number;
  qr?: { visible: boolean; size: string; corner: string };
  cork?: boolean;
  drawDuration?: number;
  tiltDeg?: number;
  winners: { rank: number }[];
};

const SCENE_LABEL: Record<string, string> = {
  QR: "QR (응모 접수)",
  COLLECTING: "응모 현황",
  FROZEN: "마감됨 (추첨 대기)",
  DRAWING: "추첨 중",
  WINNERS: "명단 공개",
};

export default function ControlPage() {
  const [token, setToken] = useState("");
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [addN, setAddN] = useState("3");
  const [durInput, setDurInput] = useState("30");
  const stopped = useRef(false);

  // 토큰은 로컬에만 보관(URL/서버 로그에 안 남김).
  useEffect(() => {
    const t = localStorage.getItem("raffle_admin_token");
    if (t) setSavedToken(t);
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (fromHash) {
      localStorage.setItem("raffle_admin_token", fromHash);
      setSavedToken(fromHash);
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    async function poll() {
      while (!stopped.current) {
        try {
          const res = await fetch("/api/state", { cache: "no-store" });
          const data = await res.json();
          if (data.ok) setState(data);
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    poll();
    return () => {
      stopped.current = true;
    };
  }, []);

  const call = useCallback(
    async (path: string, body: object): Promise<Record<string, unknown> | null> => {
      if (!savedToken) {
        setMsg("토큰을 먼저 입력하세요.");
        return null;
      }
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-token": savedToken },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.status === 401) setMsg("토큰이 틀렸습니다.");
        else if (!data.ok) setMsg(`실패: ${data.error ?? res.status}`);
        else setMsg("완료");
        return data;
      } catch {
        setMsg("네트워크 오류");
        return null;
      }
    },
    [savedToken]
  );

  function saveToken() {
    localStorage.setItem("raffle_admin_token", token);
    setSavedToken(token);
    setToken("");
    setMsg("토큰 저장됨");
  }

  const scene = state?.scene ?? "-";
  const winnerCount = state?.winners?.length ?? 0;
  const qr = state?.qr;
  const cork = state?.cork;

  if (!savedToken) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>관리자 리모컨</h1>
        <p style={{ opacity: 0.7, marginTop: 8 }}>관리자 토큰을 입력하세요.</p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="ADMIN_TOKEN"
          style={input}
        />
        <button onClick={saveToken} style={btn("#6d5cff")}>
          저장
        </button>
        {msg && <p style={{ marginTop: 12, opacity: 0.8 }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>관리자 리모컨</h1>

      <div style={statusBox}>
        <div>
          현재 단계: <b style={{ color: "#8f7bff" }}>{SCENE_LABEL[scene] ?? scene}</b>
        </div>
        <div>응모 인원: <b>{state?.entryCount ?? 0}</b>명</div>
        <div>확정 당첨: <b>{winnerCount}</b>명</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        {scene === "QR" && (
          <button style={btn("#3a3a4a")} onClick={() => call("/api/scene", { to: "COLLECTING" })}>
            응모 현황 화면으로
          </button>
        )}

        {(scene === "QR" || scene === "COLLECTING") && (
          <button
            style={btn("#c2410c")}
            onClick={() => {
              if (confirm("응모를 마감합니다. 이후 응모가 차단됩니다. 진행할까요?"))
                call("/api/scene", { to: "FROZEN" });
            }}
          >
            응모 마감
          </button>
        )}

        {scene === "FROZEN" && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 14, opacity: 0.7 }}>소요시간</span>
              <input
                value={durInput}
                onChange={(e) => setDurInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                style={{ ...input, width: 80, marginTop: 0, textAlign: "center" }}
              />
              <span style={{ fontSize: 14, opacity: 0.7 }}>초 (현재 {state?.drawDuration ?? 30}s)</span>
              <button style={{ ...miniBtn(false), flex: "0 0 auto", width: 60 }} onClick={() => call("/api/jar", { action: "setDuration", value: parseInt(durInput || "30", 10) })}>
                적용
              </button>
            </div>
            <button style={btn("#4f46e5")} onClick={() => call("/api/jar", { action: "shake" })}>
              항아리 흔들기 (추첨 전, 몇 번이든)
            </button>
            <button
              style={btn("#059669")}
              onClick={() => {
                if (confirm("당첨자 20명을 추첨합니다. 병이 뒤집힙니다. 진행할까요?"))
                  call("/api/draw", { count: 20 });
              }}
            >
              추첨 시작 (20명)
            </button>
          </>
        )}

        {(scene === "DRAWING" || scene === "WINNERS") && (
          <>
            {/* 항아리 제어: 뒤집힌 뒤 흔들고 → 코르크 열어 탈락 시작 */}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...btn("#4f46e5"), flex: 1 }} onClick={() => call("/api/jar", { action: "shake" })}>
                항아리 흔들기
              </button>
              {!cork ? (
                <button
                  style={{ ...btn("#c2410c"), flex: 1 }}
                  onClick={() => {
                    if (confirm("코르크를 열어 탈락을 시작합니다. 진행할까요?"))
                      call("/api/jar", { action: "openCork" });
                  }}
                >
                  코르크 열기
                </button>
              ) : (
                <button style={{ ...btn("#3a3a4a"), flex: 1 }} onClick={() => call("/api/jar", { action: "closeCork" })}>
                  코르크 닫기
                </button>
              )}
            </div>

            {/* 병 기울기(진행 중 슬로싱으로 안 떨어지는 버블 떨어뜨리기) */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, opacity: 0.7, flex: "0 0 auto" }}>기울기 {(state?.tiltDeg ?? 0).toFixed(0)}°</span>
              <button style={miniBtn(false)} onClick={() => call("/api/jar", { action: "tilt", delta: -12 })}>◀ 좌</button>
              <button style={miniBtn(false)} onClick={() => call("/api/jar", { action: "resetTilt" })}>정렬</button>
              <button style={miniBtn(false)} onClick={() => call("/api/jar", { action: "tilt", delta: 12 })}>우 ▶</button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={addN}
                onChange={(e) => setAddN(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                style={{ ...input, width: 80, marginTop: 0, textAlign: "center" }}
              />
              <button
                style={{ ...btn("#059669"), flex: 1 }}
                onClick={() => {
                  const n = parseInt(addN, 10);
                  if (n > 0 && confirm(`${n}명을 추가 추첨합니다. 진행할까요?`))
                    call("/api/draw", { count: n });
                }}
              >
                추가 추첨
              </button>
            </div>
            {scene === "DRAWING" && (
              <button style={btn("#6d5cff")} onClick={() => call("/api/scene", { to: "WINNERS" })}>
                당첨자 명단 공개
              </button>
            )}
          </>
        )}
      </div>

      {/* QR 표시 제어 (응모 접수 중) */}
      {(scene === "QR" || scene === "COLLECTING") && (
        <div style={{ marginTop: 24, padding: 16, borderRadius: 14, background: "#141420", border: "1px solid #24242f" }}>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 12 }}>QR 화면 제어</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button style={miniBtn(qr?.visible !== false)} onClick={() => call("/api/display", { visible: true })}>표시</button>
            <button style={miniBtn(qr?.visible === false)} onClick={() => call("/api/display", { visible: false })}>숨김</button>
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, margin: "8px 0 6px" }}>크기</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[["half", "반화면"], ["medium", "중간"], ["small", "작게"]].map(([v, label]) => (
              <button key={v} style={miniBtn(qr?.size === v)} onClick={() => call("/api/display", { size: v })}>{label}</button>
            ))}
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, margin: "8px 0 6px" }}>위치</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={miniBtn(qr?.corner === "center")} onClick={() => call("/api/display", { corner: "center" })}>가운데</button>
            <button style={miniBtn(qr?.corner === "tr")} onClick={() => call("/api/display", { corner: "tr" })}>우측 상단 ↗</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, borderTop: "1px solid #222", paddingTop: 16 }}>
        <button
          style={btn("#7f1d1d")}
          onClick={() => {
            if (
              confirm("전체 응모/당첨 데이터를 초기화합니다. (스냅샷 자동 저장) 진행할까요?") &&
              confirm("정말 초기화할까요? 되돌릴 수 없습니다.")
            ) {
              const live = scene === "DRAWING" || scene === "WINNERS";
              call("/api/reset", { confirm: "RESET", force: live });
            }
          }}
        >
          전체 리셋 (스냅샷 후 초기화)
        </button>
      </div>

      {msg && <p style={{ marginTop: 16, opacity: 0.85 }}>{msg}</p>}
    </main>
  );
}

const wrap: React.CSSProperties = {
  maxWidth: 460,
  margin: "0 auto",
  padding: 24,
  minHeight: "100dvh",
};
const input: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "14px 16px",
  fontSize: 16,
  borderRadius: 12,
  border: "1px solid #2a2a35",
  background: "#15151d",
  color: "#fff",
};
const statusBox: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  borderRadius: 14,
  background: "#15151d",
  border: "1px solid #24242f",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 16,
};
function btn(bg: string): React.CSSProperties {
  return {
    padding: "16px",
    fontSize: 17,
    fontWeight: 700,
    borderRadius: 12,
    border: "none",
    background: bg,
    color: "#fff",
    cursor: "pointer",
    width: "100%",
  };
}
function miniBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 6px",
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 10,
    border: active ? "1px solid #8f7bff" : "1px solid #2a2a35",
    background: active ? "#2a2555" : "#1a1a24",
    color: "#fff",
    cursor: "pointer",
  };
}
