"use client";

// 무대 화면 공용 컴포넌트 — 실제 운영(/stage, 서버 API)과 테스트 샌드박스(/test/stage,
// 브라우저 로컬)가 이 한 파일을 공유한다. 차이는 전송 계층(mode)뿐.

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JarCanvas, { Entry } from "./JarCanvas";
import { simGetState, simGetEntries } from "@/lib/simRaffle";

type Winner = { entryId: string; name: string; last4: string; rank: number; batch: number };
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

// 타임아웃 있는 fetch: 응답이 끊긴 채 pending으로 남으면 폴링 루프가 영구 정지한다(실측).
function fetchT(url: string, ms = 4000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
}


export default function StageView({ mode }: { mode: "live" | "test" }) {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [qr, setQr] = useState<string>("");
  const [qrUrl, setQrUrl] = useState<string>("");
  const [plain, setPlain] = useState(false);
  const [shakeSeq, setShakeSeq] = useState(0);
  const [offline, setOffline] = useState(false);
  const lastShakeAt = useRef<string | null>(null);
  const failCount = useRef(0);
  const stopped = useRef(false);

  useEffect(() => {
    setPlain(new URLSearchParams(window.location.search).get("plain") === "1");
    let url: string;
    if (mode === "test") {
      // 테스트 샌드박스는 브라우저 로컬 — 같은 컴퓨터에서 연 /test/enter 창만 반영된다.
      url = window.location.origin + "/test/enter";
    } else {
      // 환경변수가 localhost 등으로 잘못 박혀 있으면(빌드 시점 실수) 관중 QR이 전부 무반응이 된다.
      // 현재 접속 도메인이 로컬이 아닌데 env가 로컬을 가리키면 무시하고 현재 도메인을 쓴다.
      const env = process.env.NEXT_PUBLIC_EVENT_URL || "";
      const isLocalEnv = /localhost|127\.0\.0\.1/.test(env);
      const onLocal = /localhost|127\.0\.0\.1/.test(window.location.hostname);
      url = env && (!isLocalEnv || onLocal) ? env : window.location.origin + "/enter";
    }
    setQrUrl(url);
    QRCode.toDataURL(url, { width: 620, margin: 1, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => {});
  }, [mode]);

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
          let sData: State & { ok: boolean };
          let eData: { ok: boolean; entries: Entry[] };
          if (mode === "test") {
            sData = (await simGetState()) as unknown as State & { ok: boolean };
            eData = (await simGetEntries()) as unknown as { ok: boolean; entries: Entry[] };
          } else {
            const [sRes, eRes] = await Promise.all([fetchT("/api/state"), fetchT("/api/entries")]);
            sData = await sRes.json();
            eData = await eRes.json();
          }
          if (sData.ok) {
            setState(sData);
            if (sData.shakeAt && sData.shakeAt !== lastShakeAt.current) {
              lastShakeAt.current = sData.shakeAt;
              setShakeSeq((n) => n + 1);
            }
          }
          if (eData.ok) setEntries(eData.entries);
          // 연결 회복 → 배지 해제
          failCount.current = 0;
          setOffline(false);
        } catch {
          // 연속 3회(3초+) 실패 시 끊김 배지 — 조용히 멈춘 무대 방지.
          failCount.current += 1;
          if (failCount.current >= 3) setOffline(true);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    poll();
    return () => {
      stopped.current = true;
    };
  }, [mode]);

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

      {/* QR 오버레이 — 관리자가 크기/위치/표시 조절.
          "QR만 크게"(center+half) 안내 화면에서는 QR 우측에 화살표와 응모 입력화면
          미리보기를 붙여, 스캔하면 무엇이 나오는지 관중이 한눈에 알게 한다. */}
      {showQr && (() => {
        const sizeVmin = qrState.size === "half" ? 46 : qrState.size === "medium" ? 28 : 16;
        const withPreview = qrState.corner === "center" && qrState.size === "half";
        return (
          <div style={qrBoxStyle(qrState)}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4vmin" }}>
              <div style={{ width: `${sizeVmin}vmin`, flexShrink: 0 }}>
                <img src={qr} alt="응모 QR" title={qrUrl} style={{ width: "100%", borderRadius: 16, background: "#fff", padding: "4%", display: "block" }} />
                {qrState.size !== "small" && (
                  <div style={{ textAlign: "center", marginTop: 10, fontSize: qrState.size === "half" ? 24 : 16, fontWeight: 700, textShadow: "0 2px 12px #000" }}>
                    {mode === "test" ? "테스트 QR · 같은 컴퓨터의 창만 반영" : "QR을 스캔해 응모하세요"}
                    {/* QR을 못 찍는 폰을 위한 직접 입력 주소 */}
                    {mode !== "test" && qrUrl && (
                      <div style={{ marginTop: 6, fontSize: qrState.size === "half" ? 20 : 13, fontWeight: 600, opacity: 0.75, letterSpacing: 0.5 }}>
                        또는 주소 입력: <span style={{ color: "#a5b4fc" }}>{qrUrl.replace(/^https?:\/\//, "")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {withPreview && (
                <>
                  <div style={{ fontSize: "8vmin", fontWeight: 900, color: "rgba(255,255,255,0.85)", textShadow: "0 2px 16px #000", flexShrink: 0 }}>
                    →
                  </div>
                  <EnterPreview />
                </>
              )}
            </div>
          </div>
        );
      })()}

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
        // 배치 내 순번 기준 순차 등장 — 명단이 한 방에 뜨지 않고 긴장감 있게 공개된다.
        // (추가추첨 배치는 자기 배치의 0번부터 다시 스태거)
        const batchStart = new Map<number, number>();
        winners.forEach((w, i) => {
          if (!batchStart.has(w.batch)) batchStart.set(w.batch, i);
        });
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
              {winners.map((w, i) => {
                const isNew = maxBatch > 1 && w.batch === maxBatch;
                const delay = Math.min((i - (batchStart.get(w.batch) ?? 0)) * 0.35, 12);
                return (
                  <div
                    key={`${w.entryId}-${w.rank}`}
                    style={{
                      ...winnerCard,
                      position: "relative",
                      animation: `pop .5s ease ${delay}s both`,
                      ...(isNew ? { border: "2px solid #ffd24a", boxShadow: "0 0 18px rgba(255,210,74,0.35)" } : {}),
                    }}
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
            <p style={{ opacity: 0.45, marginTop: 20, fontSize: 16 }}>
              내 폰의 응모 완료 화면에서도 결과를 확인할 수 있습니다
            </p>
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

      {/* 네트워크 끊김 배지 — 조용히 멈춘 화면을 진행자가 즉시 알아채게 */}
      {offline && (
        <div style={{ position: "absolute", top: 14, right: 14, zIndex: 30, padding: "8px 16px", borderRadius: 10, background: "rgba(127,29,29,0.92)", border: "1px solid #ef4444", fontSize: 15, fontWeight: 800 }}>
          연결 끊김 — 재연결 시도 중
        </div>
      )}

      {/* 테스트 모드 워터마크 — 실제 무대와 절대 혼동하지 않게 */}
      {mode === "test" && (
        <div style={{ position: "absolute", bottom: 14, left: 14, zIndex: 20, padding: "6px 14px", borderRadius: 10, background: "rgba(127,29,29,0.85)", border: "1px solid #b91c1c", fontSize: 14, fontWeight: 800, pointerEvents: "none" }}>
          테스트 모드 — 실제 행사 아님 (이 컴퓨터에서만 동작)
        </div>
      )}

      <style>{`@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </main>
  );
}

// QR 박스 위치 계산 — 너비는 내부 QR 칼럼이 스스로 정한다(미리보기 동반 시 행이 넓어짐).
function qrBoxStyle(qr: QrState): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    zIndex: 5,
    transition: "all .6s cubic-bezier(.2,.8,.2,1)",
  };
  const m = "3vmin";
  // 우측 상단 또는 가운데만.
  if (qr.corner === "tr") return { ...base, top: m, right: m };
  return { ...base, top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
}

// 응모 입력화면 미리보기 — /enter(EnterView)의 시각 요소를 무대용 정적 목업으로 축소.
// QR 옆에 "스캔하면 이 화면이 나온다"를 보여주는 용도라 상호작용은 없다.
function EnterPreview() {
  const label: React.CSSProperties = { fontSize: "1.7vmin", opacity: 0.85, fontWeight: 600 };
  const input: React.CSSProperties = {
    padding: "1.6vmin 1.8vmin",
    fontSize: "2vmin",
    borderRadius: "1.4vmin",
    border: "1px solid #2a2a35",
    background: "#15151d",
    color: "rgba(255,255,255,0.5)",
  };
  return (
    <div
      style={{
        width: "27vmin",
        flexShrink: 0,
        padding: "3.2vmin 2.8vmin",
        borderRadius: "3.4vmin",
        border: "2px solid #34344a",
        background: "#0f0f16",
        boxShadow: "0 0 5vmin rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
        gap: "1.4vmin",
      }}
    >
      <div style={{ textAlign: "center", fontSize: "2.6vmin", fontWeight: 800 }}>추첨 응모</div>
      <div style={{ textAlign: "center", fontSize: "1.6vmin", opacity: 0.7, marginBottom: "0.6vmin" }}>
        이름과 휴대전화 뒤 4자리를 입력하세요.
      </div>
      <div style={label}>이름</div>
      <div style={input}>홍길동</div>
      <div style={label}>휴대전화 뒤 4자리</div>
      <div style={{ ...input, textAlign: "center", letterSpacing: "1vmin", fontSize: "2.4vmin" }}>0000</div>
      <div
        style={{
          marginTop: "0.8vmin",
          padding: "1.7vmin",
          fontSize: "2.1vmin",
          fontWeight: 700,
          borderRadius: "1.6vmin",
          background: "#6d5cff",
          textAlign: "center",
        }}
      >
        응모하기
      </div>
    </div>
  );
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
  borderRadius: 14,
  background: "rgba(255,210,74,0.06)",
  border: "1px solid rgba(255,210,74,0.28)",
  animation: "pop .5s ease",
};
