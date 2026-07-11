"use client";

// 관리자 리모컨 공용 컴포넌트 — 실제 운영(/control, 서버 API+토큰)과 테스트 샌드박스
// (/test/control, 브라우저 로컬)가 이 한 파일을 공유한다. 차이는 전송 계층(mode)뿐.
//
// 리모컨이 관리자의 유일한 진입점이다: 무대(프로젝터) 창을 여기서 열고,
// 무대에 QR만 보일지 / QR+항아리 / 항아리만 보일지도 여기서 제어한다.

import { useCallback, useEffect, useRef, useState } from "react";
import { simGetState, simPost } from "@/lib/simRaffle";
import { btn, chip, ghostDanger, panel, panelTitle, inputBase } from "@/lib/ui";

type State = {
  ok: boolean;
  scene: string;
  entryCount: number;
  rehearsalCount?: number;
  collisionCount?: number;
  qr?: { visible: boolean; size: string; corner: string; preview?: boolean };
  cork?: boolean;
  drawDuration?: number;
  tiltDeg?: number;
  winners: { entryId: string; name: string; last4: string; rank: number; batch: number }[];
};

// 서버 에러 코드 → 관리자가 바로 이해할 문구.
const ERROR_LABEL: Record<string, string> = {
  no_candidates: "추첨할 응모자가 없습니다 (응모 0명)",
  illegal_transition: "지금 단계에서는 허용되지 않는 전환입니다",
  live_locked: "추첨 진행 중에는 잠겨 있습니다",
  closed: "응모가 닫힌 상태입니다",
  invalid_count: "인원 수를 확인하세요",
  recent_draw: "직전 추첨과 간격이 짧습니다 — 확인 창에서 진행 여부를 선택하세요",
};

// 타임아웃 있는 fetch: 응답이 끊긴 채 pending으로 남으면 폴링 루프가 영구 정지한다(실측).
function fetchT(url: string, ms = 4000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
}

// 진행 단계 스테퍼 — 사회 진행 순서 그대로.
const STEPS: { key: string; label: string }[] = [
  { key: "QR", label: "QR접수" },
  { key: "COLLECTING", label: "응모현황" },
  { key: "FROZEN", label: "마감" },
  { key: "DRAWING", label: "추첨" },
  { key: "WINNERS", label: "명단" },
];

export default function ControlView({ mode }: { mode: "live" | "test" }) {
  const isTest = mode === "test";
  const [token, setToken] = useState("");
  // 테스트 모드는 토큰 불필요(진입 코드는 /test 게이트에서 이미 확인).
  const [savedToken, setSavedToken] = useState<string | null>(isTest ? "test-mode" : null);
  const [state, setState] = useState<State | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [addN, setAddN] = useState("3");
  const [drawN, setDrawN] = useState("20");
  const [durInput, setDurInput] = useState("30");
  const [seedN, setSeedN] = useState("20");
  const [offline, setOffline] = useState(false);
  const failCount = useRef(0);
  const stopped = useRef(false);
  // 요청 잠금: 버튼 연타로 추첨이 두 번 나가는 사고(당첨 40명) 방지.
  const inFlight = useRef(false);

  // 토큰은 로컬에만 보관(URL/서버 로그에 안 남김). 테스트 모드는 불필요.
  useEffect(() => {
    if (isTest) return;
    const t = localStorage.getItem("raffle_admin_token");
    if (t) setSavedToken(t);
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (fromHash) {
      localStorage.setItem("raffle_admin_token", fromHash);
      setSavedToken(fromHash);
      history.replaceState(null, "", window.location.pathname);
    }
  }, [isTest]);

  useEffect(() => {
    stopped.current = false;
    async function poll() {
      while (!stopped.current) {
        try {
          if (isTest) {
            const data = (await simGetState()) as unknown as State;
            if (data.ok) setState(data);
          } else {
            const res = await fetchT("/api/state");
            const data = await res.json();
            if (data.ok) setState(data);
          }
          failCount.current = 0;
          setOffline(false);
        } catch {
          // 연속 3회(3초+) 실패 = 조작 불능 상태 — 배지로 즉시 알림.
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
  }, [isTest]);

  const call = useCallback(
    async (path: string, body: object): Promise<Record<string, unknown> | null> => {
      if (!savedToken) {
        setMsg("토큰을 먼저 입력하세요.");
        return null;
      }
      if (inFlight.current) {
        setMsg("처리 중입니다 — 잠시 후 다시 시도하세요.");
        return null;
      }
      inFlight.current = true;
      try {
        // 일시적 서버/DB 오류(5xx·네트워크)는 최대 3회 자동 재시도한다. 트랜잭션 풀러
        // 전환으로 대부분 사라졌지만, 순간 블립에도 관리자 조작(추첨·리셋·전이)이 한 번에
        // 반영되게 한다. 4xx(토큰 오류·recent_draw·불법 전이 등)는 의도된 응답이라 재시도 안 함.
        // 추첨 재시도의 이중 실행 위험은 서버의 recent_draw 가드(15초)가 막는다.
        let status = 0;
        let data: Record<string, unknown> | null = null;
        let lastErr = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (isTest) {
              const r = await simPost(path, body as Record<string, unknown>);
              status = r.status;
              data = r.data;
            } else {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 8000);
              const res = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-token": savedToken },
                body: JSON.stringify(body),
                signal: ctrl.signal,
              }).finally(() => clearTimeout(timer));
              status = res.status;
              data = await res.json();
            }
            lastErr = false;
            if (status < 500) break; // 성공 또는 4xx(의도된 실패) → 재시도 불필요
          } catch {
            lastErr = true; // 네트워크/타임아웃 → 재시도
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
        if (lastErr || !data) {
          setMsg("네트워크 오류 — 반영 여부를 위 상태에서 확인 후 다시 시도하세요.");
          return null;
        }
        if (status === 401) setMsg("토큰이 틀렸습니다.");
        else if (status >= 500) setMsg("서버 오류가 반복됩니다 — 잠시 후 다시 시도하세요.");
        else if (!data.ok) setMsg(`실패: ${ERROR_LABEL[String(data.error)] ?? data.error ?? status}`);
        else setMsg("완료");
        return data;
      } finally {
        inFlight.current = false;
      }
    },
    [savedToken, isTest]
  );

  function saveToken() {
    localStorage.setItem("raffle_admin_token", token);
    setSavedToken(token);
    setToken("");
    setMsg("토큰 저장됨");
  }

  // 전체 리셋 — 헤더(항상 보임)에서 호출. 라이브(추첨 결과 존재) 중엔 RESET 타이핑 확인.
  function doReset() {
    if (!confirm("전체 응모/당첨 데이터를 초기화합니다. (스냅샷 자동 저장) 진행할까요?")) return;
    const live = scene === "DRAWING" || scene === "WINNERS";
    if (live) {
      const typed = prompt("추첨 결과가 이미 있습니다! 명단이 삭제됩니다.\n정말 초기화하려면 RESET 을 입력하세요:");
      if (typed !== "RESET") return setMsg("리셋 취소됨");
    } else if (!confirm("정말 초기화할까요? 되돌릴 수 없습니다.")) {
      return;
    }
    runReset(live);
  }

  // 무대(프로젝터) 창 — 리모컨에서 연다. 관리자가 /stage 주소를 외울 필요 없음.
  function openStage() {
    const path = isTest ? "/test/stage" : "/stage";
    const w = window.open(
      path,
      "raffle_stage",
      "popup=yes,width=1280,height=800,left=80,top=60,toolbar=no,menubar=no,location=no,status=no"
    );
    // 팝업 차단 시 무반응으로 끝나지 않게 — 원인과 대안을 즉시 안내.
    if (!w) setMsg(`팝업이 차단되었습니다. 브라우저 팝업을 허용하거나 주소창에 ${path} 를 직접 입력하세요.`);
  }

  // 추첨 결과 보고: 응모 인원이 부족하면 "완료"로 뭉개지 않고 명시적으로 알린다.
  const runDraw = useCallback(
    async (count: number) => {
      let d = await call("/api/draw", { count });
      // 연속 추첨 가드(서버): 직전 추첨 15초 내 재요청 — 새로고침 직후의 이중 클릭이
      // 아닌지 사람에게 재확인시키고, 의도된 추가 추첨이면 force 로 진행한다.
      if (d && !d.ok && d.error === "recent_draw") {
        const ask =
          `${d.secondsAgo}초 전에 이미 배치 ${d.batch}(${d.count}명) 추첨이 실행되었습니다.\n` +
          `새로고침 직후라면 중복 실행일 수 있습니다.\n그래도 ${count}명을 추가로 추첨할까요?`;
        if (!confirm(ask)) {
          setMsg("추첨 취소됨 — 직전 추첨이 이미 반영되어 있습니다.");
          return;
        }
        d = await call("/api/draw", { count, force: true });
      }
      if (!d?.ok) return;
      const shortfall = Number(d.shortfall ?? 0);
      if (shortfall > 0) {
        setMsg(`후보 부족: 요청 ${d.requested}명 중 ${d.drawn}명만 추첨됨`);
      } else {
        setMsg(`추첨 완료: ${d.drawn}명`);
      }
    },
    [call]
  );

  // 리셋 스냅샷을 브라우저 파일로 저장 — 서버리스에선 서버측 파일이 증발하므로
  // 이 다운로드가 실질적인 백업이다.
  const runReset = useCallback(
    async (force: boolean) => {
      const d = await call("/api/reset", { confirm: "RESET", force });
      if (!d?.ok) return;
      const cleared = d.cleared as { entries?: number; winners?: number } | undefined;
      if (d.snapshotData) {
        try {
          const blob = new Blob([JSON.stringify(d.snapshotData, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `raffle-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch {
          /* 다운로드 실패해도 리셋 자체는 완료 */
        }
      }
      setMsg(`리셋 완료 (응모 ${cleared?.entries ?? 0}·당첨 ${cleared?.winners ?? 0} — 스냅샷 다운로드됨)`);
    },
    [call]
  );

  const scene = state?.scene ?? "-";
  const winnerCount = state?.winners?.length ?? 0;
  const qr = state?.qr;
  const cork = state?.cork;
  // 무대 표시 프리셋 판정: 숨김=항아리만 · 가운데=QR만 크게 · 그 외=QR+항아리.
  const preset = qr?.visible === false ? "jar" : qr?.corner === "center" ? "qr" : "both";

  if (!savedToken) {
    return (
      <main style={{ ...wrap, justifyContent: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, textAlign: "center" }}>관리자 리모컨</h1>
        <p style={{ opacity: 0.7, marginTop: 8, textAlign: "center", fontSize: 14 }}>
          관리자 토큰을 입력하세요.
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="ADMIN_TOKEN"
          style={{ ...inputBase, width: "100%", marginTop: 14, padding: "14px 16px" }}
        />
        <button onClick={saveToken} style={{ ...btn("violet", { size: "lg" }), marginTop: 12 }}>
          저장
        </button>
        {msg && <p style={{ marginTop: 12, opacity: 0.8, textAlign: "center" }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={wrap}>
      {/* 헤더: 제목 + 무대 창 열기 — 관리자에게 필요한 창은 전부 여기서 연다 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, flex: 1, lineHeight: 1.2 }}>
          관리자 리모컨
          {isTest && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, background: "#7f1d1d", padding: "2px 8px", borderRadius: 7, verticalAlign: "middle" }}>
              테스트
            </span>
          )}
        </h1>
        <button style={{ ...btn("sky", { size: "sm" }), width: "auto", whiteSpace: "nowrap" }} onClick={openStage}>
          무대 화면 ↗
        </button>
        {/* 전체 리셋 — 항상 보이게 헤더에 고정(내용이 길어도 스크롤 없이 접근). */}
        <button
          style={{ ...btn("red", { size: "sm" }), width: "auto", whiteSpace: "nowrap" }}
          onClick={doReset}
        >
          전체 리셋
        </button>
      </div>
      {isTest && (
        <p style={{ fontSize: 12, opacity: 0.55, lineHeight: 1.5 }}>
          이 컴퓨터 안에서만 동작하는 연습용 — 실제 행사 데이터에 영향 없음.
        </p>
      )}

      {/* 네트워크 끊김 — 리모컨 조작이 안 먹는 상태를 즉시 알림 */}
      {offline && (
        <div style={{ padding: "9px 12px", borderRadius: 10, background: "rgba(127,29,29,0.9)", border: "1px solid #ef4444", fontSize: 13.5, fontWeight: 800 }}>
          서버 연결 끊김 — 재연결 시도 중 (조작이 반영되지 않을 수 있음)
        </div>
      )}

      {/* 진행 단계 스테퍼 + 핵심 숫자 */}
      <div style={panel}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {STEPS.map((s, i) => {
            const active = s.key === scene;
            const passed = STEPS.findIndex((x) => x.key === scene) > i;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "6px 2px",
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    background: active ? "#6d5cff" : passed ? "rgba(109,92,255,0.12)" : "transparent",
                    color: active ? "#fff" : passed ? "#a99cff" : "#4e4e5e",
                    border: active ? "1px solid transparent" : "1px solid #23232f",
                  }}
                >
                  {s.label}
                </div>
                {i < STEPS.length - 1 && <span style={{ color: "#3a3a4a", fontSize: 10, padding: "0 2px" }}>›</span>}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 14.5 }}>
          <span>응모 <b style={{ color: "#8f7bff", fontSize: 17 }}>{state?.entryCount ?? 0}</b>명</span>
          <span>당첨 <b style={{ color: "#ffd24a", fontSize: 17 }}>{winnerCount}</b>명</span>
          {(state?.collisionCount ?? 0) > 0 && (
            <span style={{ color: "#fbbf24", fontSize: 12.5, alignSelf: "center" }}>
              중복 시도 {state?.collisionCount}건
            </span>
          )}
        </div>
      </div>

      {/* 리허설 데이터 잔존 경고: 본행사에 가상 인물이 당첨되는 사고 방지 */}
      {(state?.rehearsalCount ?? 0) > 0 && (
        <div style={{ padding: 12, borderRadius: 12, background: "#3b1113", border: "1px solid #7f1d1d", fontSize: 13.5 }}>
          <b style={{ color: "#fca5a5" }}>가상(리허설) 응모 {state?.rehearsalCount}명 포함</b>
          <span style={{ opacity: 0.8 }}> — 본행사 전 삭제 필요</span>
          {(scene === "QR" || scene === "COLLECTING" || scene === "FROZEN") && (
            <button
              style={{ ...btn("red", { size: "sm" }), marginTop: 8 }}
              onClick={async () => {
                if (!confirm("가상 응모만 삭제합니다(실제 응모는 유지). 진행할까요?")) return;
                const d = await call("/api/rehearsal", { action: "clear" });
                if (d?.ok) setMsg(`가상 응모 ${d.deleted}명 삭제됨`);
              }}
            >
              가상 응모 {state?.rehearsalCount}명 지금 삭제
            </button>
          )}
        </div>
      )}

      {/* 무대 표시 — 무대에 뭘 보여줄지 여기서 결정 (응모 접수 중) */}
      {(scene === "QR" || scene === "COLLECTING") && (
        <div style={panel}>
          <div style={panelTitle}>무대 표시</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={chip(preset === "qr")} onClick={() => call("/api/display", { visible: true, size: "half", corner: "center" })}>
              QR만 크게
            </button>
            <button style={chip(preset === "both")} onClick={() => call("/api/display", { visible: true, size: "medium", corner: "tr" })}>
              QR+항아리
            </button>
            <button style={chip(preset === "jar")} onClick={() => call("/api/display", { visible: false })}>
              항아리만
            </button>
          </div>
          {qr?.visible !== false && (
            <>
              {/* QR 위치·크기 미세 조정 — 프리셋과 무관하게 항상 가능 */}
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.55, flex: "0 0 auto" }}>QR 위치</span>
                <button style={chip(qr?.corner === "center")} onClick={() => call("/api/display", { corner: "center" })}>가운데</button>
                <button style={chip(qr?.corner === "tr")} onClick={() => call("/api/display", { corner: "tr" })}>우측 상단</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.55, flex: "0 0 auto" }}>QR 크기</span>
                <button style={chip(qr?.size === "half")} onClick={() => call("/api/display", { size: "half" })}>크게</button>
                <button style={chip(qr?.size === "medium")} onClick={() => call("/api/display", { size: "medium" })}>중간</button>
                <button style={chip(qr?.size === "small")} onClick={() => call("/api/display", { size: "small" })}>작게</button>
              </div>
              {/* 입력폼 미리보기 토글 — 작게(small)에서는 무대가 표시 공간이 없어 자동 생략됨 */}
              <label style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={qr?.preview !== false}
                  onChange={(e) => call("/api/display", { preview: e.target.checked })}
                  style={{ width: 17, height: 17, accentColor: "#6d5cff" }}
                />
                입력폼 미리보기 함께 표시
                {qr?.corner === "tr" ? (
                  <span style={{ opacity: 0.5, fontWeight: 500 }}>(우측 상단에서는 생략)</span>
                ) : qr?.size === "small" ? (
                  <span style={{ opacity: 0.5, fontWeight: 500 }}>(작게에서는 생략)</span>
                ) : null}
              </label>
            </>
          )}
        </div>
      )}

      {/* 진행 동작 — 현재 단계에서 가능한 것만 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {scene === "QR" && (
          <button style={btn("slate")} onClick={() => call("/api/scene", { to: "COLLECTING" })}>
            응모 현황 화면으로
          </button>
        )}

        {(scene === "QR" || scene === "COLLECTING") && (
          <button
            style={btn("orange", { size: "lg" })}
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
            <button style={btn("indigo")} onClick={() => call("/api/jar", { action: "shake" })}>
              항아리 흔들기 (추첨 전, 몇 번이든)
            </button>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                value={drawN}
                onChange={(e) => setDrawN(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                style={{ ...inputBase, width: 72, textAlign: "center", fontWeight: 800 }}
              />
              <button
                style={{ ...btn("green", { size: "lg" }), flex: 1 }}
                onClick={() => {
                  const n = parseInt(drawN, 10);
                  if (!(n > 0)) return setMsg("추첨 인원을 확인하세요.");
                  const warn = (state?.rehearsalCount ?? 0) > 0 ? `\n가상(리허설) 응모 ${state?.rehearsalCount}명이 포함되어 있습니다!` : "";
                  if (confirm(`당첨자 ${n}명을 추첨합니다. 병이 뒤집힙니다.${warn} 진행할까요?`)) runDraw(n);
                }}
              >
                추첨 시작 ({drawN || "?"}명)
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, opacity: 0.6, flex: "0 0 auto" }}>배출 소요</span>
              <input
                value={durInput}
                onChange={(e) => setDurInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                style={{ ...inputBase, width: 60, textAlign: "center" }}
              />
              <span style={{ fontSize: 13, opacity: 0.6 }}>초 (현재 {state?.drawDuration ?? 30}s)</span>
              <button
                style={{ ...btn("slate", { size: "sm" }), width: "auto" }}
                onClick={() => call("/api/jar", { action: "setDuration", value: parseInt(durInput || "30", 10) })}
              >
                적용
              </button>
            </div>
            <button
              style={{ ...ghostDanger, borderColor: "#3a3a4a", background: "rgba(58,58,74,0.2)", color: "#c7c7d4" }}
              onClick={() => {
                if (confirm("마감을 취소하고 응모를 다시 받습니다. 진행할까요?"))
                  call("/api/scene", { to: "COLLECTING" });
              }}
            >
              마감 취소 (응모 재개)
            </button>
          </>
        )}

        {(scene === "DRAWING" || scene === "WINNERS") && (
          <>
            {/* 항아리 제어: 뒤집힌 뒤 흔들고 → 코르크 열어 탈락 시작 */}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...btn("indigo"), flex: 1 }} onClick={() => call("/api/jar", { action: "shake" })}>
                항아리 흔들기
              </button>
              {!cork ? (
                <button
                  style={{ ...btn("orange"), flex: 1 }}
                  onClick={() => {
                    if (confirm("코르크를 열어 탈락을 시작합니다. 진행할까요?"))
                      call("/api/jar", { action: "openCork" });
                  }}
                >
                  코르크 열기
                </button>
              ) : (
                <button style={{ ...btn("slate"), flex: 1 }} onClick={() => call("/api/jar", { action: "closeCork" })}>
                  코르크 닫기
                </button>
              )}
            </div>

            {/* 병 기울기(진행 중 슬로싱으로 안 떨어지는 버블 떨어뜨리기) */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, opacity: 0.6, flex: "0 0 auto", width: 64 }}>
                기울기 {(state?.tiltDeg ?? 0).toFixed(0)}°
              </span>
              <button style={chip(false)} onClick={() => call("/api/jar", { action: "tilt", delta: -12 })}>좌</button>
              <button style={chip(false)} onClick={() => call("/api/jar", { action: "resetTilt" })}>정렬</button>
              <button style={chip(false)} onClick={() => call("/api/jar", { action: "tilt", delta: 12 })}>우</button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                value={addN}
                onChange={(e) => setAddN(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                style={{ ...inputBase, width: 72, textAlign: "center", fontWeight: 800 }}
              />
              <button
                style={{ ...btn("green"), flex: 1 }}
                onClick={() => {
                  const n = parseInt(addN, 10);
                  if (n > 0 && confirm(`${n}명을 추가 추첨합니다. 진행할까요?`)) runDraw(n);
                }}
              >
                추가 추첨
              </button>
            </div>
            {scene === "DRAWING" && (
              <button style={btn("violet", { size: "lg" })} onClick={() => call("/api/scene", { to: "WINNERS" })}>
                당첨자 명단 공개
              </button>
            )}

            {/* 명단 백업: DB 장애 대비 + 사회자 호명용/인쇄용. 서버 불필요(폴링된 명단 사용). */}
            <button
              style={btn("navy")}
              onClick={() => {
                const ws = state?.winners ?? [];
                if (ws.length === 0) return setMsg("아직 당첨자가 없습니다.");
                const rows = [["순번", "이름", "뒤4자리", "배치"], ...ws.map((w) => [w.rank, w.name, w.last4, w.batch])];
                // BOM: 엑셀에서 한글 깨짐 방지.
                const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `당첨명단_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
                setMsg(`당첨 명단 ${ws.length}명 다운로드됨`);
              }}
            >
              당첨 명단 다운로드 (CSV, {winnerCount}명)
            </button>
          </>
        )}
      </div>

      {/* 리허설: 가상 응모 투입(응모 접수 중에만) — 실제 관중 없이 전체 시나리오 시연 */}
      {(scene === "QR" || scene === "COLLECTING") && (
        <div style={panel}>
          <div style={panelTitle}>리허설 (가상 응모) — 시연 후 전체 리셋 필수</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[20, 100, 300].map((n) => (
              <button key={n} style={chip(seedN === String(n))} onClick={() => setSeedN(String(n))}>
                {n}명
              </button>
            ))}
            <input
              value={seedN}
              onChange={(e) => setSeedN(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              style={{ ...inputBase, width: 58, textAlign: "center", padding: "9px 4px", fontSize: 14 }}
            />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              style={{ ...btn("navy", { size: "sm" }), flex: 1 }}
              onClick={async () => {
                const n = parseInt(seedN, 10);
                if (!(n > 0)) return;
                const d = await call("/api/rehearsal", { action: "seed", count: n });
                if (d?.ok) setMsg(`가상 응모 ${d.seeded}명 투입됨`);
              }}
            >
              가상 응모 투입
            </button>
            <button
              style={{ ...btn("slate", { size: "sm" }), flex: 1 }}
              onClick={async () => {
                if (!confirm("가상 응모만 삭제합니다(실제 응모는 유지). 진행할까요?")) return;
                const d = await call("/api/rehearsal", { action: "clear" });
                if (d?.ok) setMsg(`가상 응모 ${d.deleted}명 삭제됨`);
              }}
            >
              가상 응모만 삭제
            </button>
          </div>
        </div>
      )}

      {/* 결과 토스트 — 스크롤 없이 항상 보이게 화면 하단 고정 */}
      {msg && (
        <div
          onClick={() => setMsg("")}
          style={{
            position: "fixed",
            left: "50%",
            bottom: 14,
            transform: "translateX(-50%)",
            maxWidth: "min(440px, 92vw)",
            padding: "10px 18px",
            borderRadius: 12,
            background: "rgba(28,28,40,0.96)",
            border: "1px solid #3a3a4d",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            fontSize: 13.5,
            zIndex: 50,
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          {msg}
        </div>
      )}
    </main>
  );
}

const wrap: React.CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  padding: "14px 14px 18px",
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
