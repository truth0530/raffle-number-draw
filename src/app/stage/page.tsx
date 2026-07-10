"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JarCanvas, { Entry } from "./JarCanvas";

type Winner = { entryId: string; name: string; last4: string; rank: number; batch: number };

// 타임아웃 있는 fetch: 응답이 끊긴 채 pending으로 남으면 폴링 루프가 영구 정지한다(실측).
function fetchT(url: string, ms = 4000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
}
type QrState = { visible: boolean; size: string; corner: string };
type State = {
  ok: boolean;
  scene: string;
  entryCount: number;
  qr: QrState;
  cork: boolean;
  shakeAt: string | null;
  drawDuration: number;
  tiltDeg: number;
  winners: Winner[];
};

export default function StagePage() {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [qr, setQr] = useState<string>("");
  const [qrUrl, setQrUrl] = useState<string>("");
  const [plain, setPlain] = useState(false);
  const [shakeSeq, setShakeSeq] = useState(0);
  const lastShakeAt = useRef<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    setPlain(new URLSearchParams(window.location.search).get("plain") === "1");
    // 환경변수가 localhost 등으로 잘못 박혀 있으면(빌드 시점 실수) 관중 QR이 전부 무반응이 된다.
    // 현재 접속 도메인이 로컬이 아닌데 env가 로컬을 가리키면 무시하고 현재 도메인을 쓴다.
    const env = process.env.NEXT_PUBLIC_EVENT_URL || "";
    const isLocalEnv = /localhost|127\.0\.0\.1/.test(env);
    const onLocal = /localhost|127\.0\.0\.1/.test(window.location.hostname);
    const url = env && (!isLocalEnv || onLocal) ? env : window.location.origin + "/enter";
    setQrUrl(url);
    QRCode.toDataURL(url, { width: 620, margin: 1, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => {});
  }, []);

  // 무대 노트북 절전/화면꺼짐 방지(Wake Lock). 탭이 다시 보이면 재획득.
  useEffect(() => {
    type WakeLockSentinelLike = { release?: () => Promise<void> } | null;
    let lock: WakeLockSentinelLike = null;
    let stop = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<NonNullable<WakeLockSentinelLike>> };
    };
    async function acquire() {
      try {
        if (!nav.wakeLock || stop) return;
        lock = await nav.wakeLock.request("screen");
      } catch {
        /* 미지원/저전력 모드 — 무해 */
      }
    }
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
    };
  }, []);

  useEffect(() => {
    stopped.current = false;
    async function poll() {
      while (!stopped.current) {
        try {
          const [sRes, eRes] = await Promise.all([
            fetchT("/api/state"),
            fetchT("/api/entries"),
          ]);
          const sData = await sRes.json();
          const eData = await eRes.json();
          if (sData.ok) {
            setState(sData);
            if (sData.shakeAt && sData.shakeAt !== lastShakeAt.current) {
              lastShakeAt.current = sData.shakeAt;
              setShakeSeq((n) => n + 1);
            }
          }
          if (eData.ok) setEntries(eData.entries);
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

  const scene = state?.scene ?? "QR";
  const winners = state?.winners ?? [];
  // 버블 매칭은 entryId로(이름·전화가 화면 매칭에 불필요 — /api/entries 에서 last4 제거 가능해짐).
  const winnerKeys = new Set(winners.map((w) => w.entryId));
  const qrState = state?.qr ?? { visible: true, size: "half", corner: "center" };

  const showJar =
    !plain && (scene === "QR" || scene === "COLLECTING" || scene === "FROZEN" || scene === "DRAWING");
  const showQr = (scene === "QR" || scene === "COLLECTING") && qrState.visible && qr;

  return (
    <main
      style={{
        height: "100dvh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
        background: "#0a0a0f",
      }}
    >
      {showJar && (
        <JarCanvas
          scene={scene}
          entries={entries}
          winnerKeys={winnerKeys}
          corkOpen={state?.cork ?? false}
          shakeSeq={shakeSeq}
          durationMs={(state?.drawDuration ?? 30) * 1000}
          tiltDeg={state?.tiltDeg ?? 0}
        />
      )}

      {/* 응모 인원 카운트 */}
      {(scene === "QR" || scene === "COLLECTING") && (
        <div style={{ position: "absolute", top: 24, left: 0, right: 0, textAlign: "center", pointerEvents: "none", textShadow: "0 2px 16px #000" }}>
          <div style={{ fontSize: 30, fontWeight: 800 }}>
            현재 응모 <span style={{ color: "#8f7bff" }}>{state?.entryCount ?? 0}</span>명
          </div>
        </div>
      )}

      {/* QR 오버레이 — 관리자가 크기/위치/표시 조절 */}
      {showQr && (
        <div style={qrBoxStyle(qrState)}>
          <img src={qr} alt="응모 QR" title={qrUrl} style={{ width: "100%", height: "100%", borderRadius: 16, background: "#fff", padding: "4%" }} />
          {qrState.size !== "small" && (
            <div style={{ textAlign: "center", marginTop: 10, fontSize: qrState.size === "half" ? 24 : 16, fontWeight: 700, textShadow: "0 2px 12px #000" }}>
              QR을 스캔해 응모하세요
            </div>
          )}
        </div>
      )}

      {scene === "FROZEN" && (
        <Overlay>
          <h1 style={{ fontSize: 60, fontWeight: 900 }}>응모 마감</h1>
          <p style={{ fontSize: 30, opacity: 0.85, marginTop: 16 }}>
            총 {state?.entryCount ?? 0}명 · 곧 추첨을 시작합니다
          </p>
        </Overlay>
      )}

      {scene === "DRAWING" && (
        <div style={{ position: "absolute", top: 24, left: 0, right: 0, textAlign: "center", pointerEvents: "none", textShadow: "0 2px 16px #000" }}>
          <h1 style={{ fontSize: 46, fontWeight: 900, color: "#ffd24a" }}>추첨 중…</h1>
        </div>
      )}

      {scene === "WINNERS" && (() => {
        // 추가추첨(2차 이후 배치) 당첨자는 사회자가 구분해 호명할 수 있게 강조.
        const maxBatch = winners.reduce((m, w) => Math.max(m, w.batch), 1);
        return (
          <Center>
            <h1 style={{ fontSize: 56, fontWeight: 900, color: "#ffd24a", marginBottom: 8 }}>
              당첨을 축하드립니다
            </h1>
            <p style={{ opacity: 0.6, marginBottom: 24 }}>총 {winners.length}명</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(${winners.length > 24 ? 180 : 220}px, 1fr))`,
                gap: 14,
                width: "min(1200px, 92vw)",
              }}
            >
              {winners.map((w) => {
                const isNew = maxBatch > 1 && w.batch === maxBatch;
                return (
                  <div
                    key={`${w.entryId}-${w.rank}`}
                    style={{ ...winnerCard, position: "relative", ...(isNew ? { border: "2px solid #ffd24a", boxShadow: "0 0 18px rgba(255,210,74,0.35)" } : {}) }}
                  >
                    {isNew && (
                      <div style={{ position: "absolute", top: -10, right: -6, fontSize: 13, fontWeight: 800, background: "#ffd24a", color: "#1a1400", padding: "2px 8px", borderRadius: 8 }}>
                        추가
                      </div>
                    )}
                    <div style={{ fontSize: 30, fontWeight: 800 }}>{w.name}</div>
                    <div style={{ fontSize: 24, color: "#ffd24a", letterSpacing: 3 }}>{w.last4}</div>
                  </div>
                );
              })}
            </div>
          </Center>
        );
      })()}

      {/* plain 폴백: DRAWING 연출 대신 명단만 */}
      {plain && scene === "DRAWING" && (
        <Center>
          <h1 style={{ fontSize: 40, fontWeight: 800 }}>추첨 결과</h1>
          <ul style={{ marginTop: 16, fontSize: 24, columns: 2, listStyle: "none" }}>
            {winners.map((w) => (
              <li key={w.rank}>{w.name} · {w.last4}</li>
            ))}
          </ul>
        </Center>
      )}

      <style>{`@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </main>
  );
}

// QR 박스 크기/위치 계산
function qrBoxStyle(qr: QrState): React.CSSProperties {
  const sizeVmin = qr.size === "half" ? 46 : qr.size === "medium" ? 28 : 16;
  const base: React.CSSProperties = {
    position: "absolute",
    width: `${sizeVmin}vmin`,
    zIndex: 5,
    transition: "all .6s cubic-bezier(.2,.8,.2,1)",
  };
  const m = "3vmin";
  // 우측 상단 또는 가운데만.
  if (qr.corner === "tr") return { ...base, top: m, right: m };
  return { ...base, top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
      {children}
    </div>
  );
}
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", textAlign: "center", pointerEvents: "none", textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
      {children}
    </div>
  );
}
const winnerCard: React.CSSProperties = {
  padding: "16px 10px",
  borderRadius: 16,
  background: "linear-gradient(180deg,#1d1a10,#17171f)",
  border: "1px solid #4a3d18",
  animation: "pop .5s ease",
};
