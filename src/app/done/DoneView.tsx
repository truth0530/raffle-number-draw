"use client";

// 응모 완료 + 내 결과 실시간 확인 — 실제(/done)와 테스트(/test/enter/done)가 공유.
// 응모자가 무대 구석 명단에서 자기 이름을 찾아 헤매지 않도록, 폰에서
// 대기 → 마감 → 추첨 중 → 당첨/미당첨 을 직접 보여준다.
// 발표의 긴장감을 위해 개인 결과는 무대 명단 공개(WINNERS) 시점에만 노출.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { simGetState } from "@/lib/simRaffle";
import { loadMyEntries, clearMyEntries, MyEntry } from "@/lib/myEntries";

type Winner = { entryId: string; name: string; last4: string; rank: number; batch: number };
type State = { ok: boolean; scene: string; entryCount: number; winners: Winner[] };

function fetchT(url: string, ms = 4000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
}

export default function DoneView({ mode }: { mode: "live" | "test" }) {
  const isTest = mode === "test";
  const [mine, setMine] = useState<MyEntry[]>([]);
  const [state, setState] = useState<State | null>(null);
  const [stale, setStale] = useState(false); // 행사 리셋으로 내 응모가 사라진 상태
  const stopped = useRef(false);
  const seenCount = useRef(0);

  useEffect(() => {
    setMine(loadMyEntries(mode));
  }, [mode]);

  // 폴링: 관중 수백 명이 이 화면을 열어두므로 라이브는 5초+지터로 느슨하게.
  useEffect(() => {
    stopped.current = false;
    async function poll() {
      while (!stopped.current) {
        try {
          let data: State;
          if (isTest) {
            data = (await simGetState()) as unknown as State;
          } else {
            const res = await fetchT("/api/state");
            data = await res.json();
          }
          if (data.ok) {
            // 리셋 감지: 응모가 있었는데(내 폰 기록 존재) 서버가 처음 상태로 돌아감.
            if (data.entryCount > 0) seenCount.current = Math.max(seenCount.current, data.entryCount);
            setStale(seenCount.current > 0 && data.scene === "QR" && data.entryCount === 0);
            setState(data);
          }
        } catch {
          /* 다음 주기에 재시도 */
        }
        await new Promise((r) => setTimeout(r, isTest ? 1500 : 5000 + Math.random() * 2000));
      }
    }
    poll();
    return () => {
      stopped.current = true;
    };
  }, [isTest, mode]);

  const scene = state?.scene ?? "";
  const winners = state?.winners ?? [];
  const enterHref = isTest ? "/test/enter" : "/enter";

  function matchWin(e: MyEntry): Winner | undefined {
    return winners.find(
      (w) => (e.entryId && w.entryId === e.entryId) || (w.name === e.name && w.last4 === e.last4)
    );
  }

  if (mine.length === 0) {
    return (
      <Wrap isTest={isTest}>
        <div style={{ fontSize: 56 }}>🤔</div>
        <h1 style={h1}>이 폰의 응모 내역이 없습니다</h1>
        <Link href={enterHref} style={linkBtn}>응모하러 가기 →</Link>
      </Wrap>
    );
  }

  if (stale) {
    return (
      <Wrap isTest={isTest}>
        <div style={{ fontSize: 56 }}>🔄</div>
        <h1 style={h1}>행사 데이터가 초기화되었습니다</h1>
        <p style={sub}>새 추첨이 시작되면 다시 응모해 주세요.</p>
        <Link
          href={enterHref}
          style={linkBtn}
          onClick={() => clearMyEntries(mode)}
        >
          다시 응모하기 →
        </Link>
      </Wrap>
    );
  }

  // 명단 공개 — 개인 결과 표시
  if (scene === "WINNERS") {
    const results = mine.map((e) => ({ e, win: matchWin(e) }));
    const anyWin = results.some((r) => r.win);
    return (
      <Wrap isTest={isTest}>
        <div style={{ fontSize: 56 }}>{anyWin ? "🎉" : "🍀"}</div>
        <h1 style={h1}>{anyWin ? "축하합니다!" : "추첨 결과"}</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18, width: "100%", maxWidth: 340 }}>
          {results.map(({ e, win }) => (
            <div
              key={`${e.name}-${e.last4}`}
              style={{
                padding: "14px 16px",
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: win ? "linear-gradient(180deg,#3d3212,#211b09)" : "#15151d",
                border: win ? "1.5px solid #ffd24a" : "1px solid #24242f",
                boxShadow: win ? "0 0 18px rgba(255,210,74,0.25)" : "none",
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 800, flex: 1, textAlign: "left" }}>
                {e.name} <span style={{ opacity: 0.5, fontSize: 14 }}>{e.last4}</span>
              </span>
              {win ? (
                <b style={{ color: "#ffd24a", fontSize: 16 }}>당첨 🎉</b>
              ) : (
                <span style={{ opacity: 0.55, fontSize: 14 }}>미당첨</span>
              )}
            </div>
          ))}
        </div>
        <p style={sub}>
          {anyWin
            ? "무대 앞으로 오셔서 이름과 전화 뒤 4자리로 본인 확인을 해주세요."
            : "참여해 주셔서 감사합니다. 추가 추첨이 있을 수 있으니 잠시 지켜봐 주세요!"}
        </p>
      </Wrap>
    );
  }

  // 추첨 진행 중 — 스포일러 없이 무대로 시선 유도
  if (scene === "DRAWING") {
    return (
      <Wrap isTest={isTest}>
        <div style={{ fontSize: 56 }}>🎲</div>
        <h1 style={h1}>추첨이 진행 중입니다</h1>
        <p style={sub}>
          무대 화면을 봐주세요! 명단이 공개되면
          <br />이 화면에 <b>내 결과</b>가 바로 표시됩니다.
        </p>
        <Names mine={mine} />
      </Wrap>
    );
  }

  if (scene === "FROZEN") {
    return (
      <Wrap isTest={isTest}>
        <div style={{ fontSize: 56 }}>⏳</div>
        <h1 style={h1}>응모 마감 — 곧 추첨이 시작됩니다</h1>
        <p style={sub}>총 {state?.entryCount ?? 0}명 응모 · 이 화면을 켜두면 결과가 자동 표시됩니다.</p>
        <Names mine={mine} />
      </Wrap>
    );
  }

  // 접수 중(QR/COLLECTING) 또는 상태 미수신
  return (
    <Wrap isTest={isTest}>
      <div style={{ fontSize: 56 }}>🎉</div>
      <h1 style={h1}>응모가 완료되었습니다</h1>
      <p style={sub}>
        {state ? <>현재 <b style={{ color: "#8f7bff" }}>{state.entryCount}</b>명 응모 중 · </> : null}
        이 화면을 켜두면 추첨 결과가 자동 표시됩니다.
      </p>
      <Names mine={mine} />
      <Link href={enterHref} style={{ ...linkBtn, marginTop: 20, fontSize: 14, opacity: 0.75 }}>
        같은 폰으로 가족·일행 응모하기 →
      </Link>
    </Wrap>
  );
}

function Names({ mine }: { mine: MyEntry[] }) {
  return (
    <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
      {mine.map((e) => (
        <span
          key={`${e.name}-${e.last4}`}
          style={{ padding: "6px 14px", borderRadius: 999, background: "#1c1c28", border: "1px solid #2c2c3a", fontSize: 14.5, fontWeight: 700 }}
        >
          {e.name} <span style={{ opacity: 0.45, fontSize: 12.5 }}>{e.last4}</span>
        </span>
      ))}
    </div>
  );
}

function Wrap({ isTest, children }: { isTest: boolean; children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      {isTest && (
        <div style={{ marginBottom: 14, fontSize: 12.5, fontWeight: 800, background: "#7f1d1d", padding: "4px 12px", borderRadius: 8 }}>
          🧪 테스트 모드 — 실제 행사 아님
        </div>
      )}
      {children}
    </main>
  );
}

const h1: React.CSSProperties = { fontSize: 25, fontWeight: 800, marginTop: 14, lineHeight: 1.35 };
const sub: React.CSSProperties = { opacity: 0.7, marginTop: 12, fontSize: 15.5, lineHeight: 1.65 };
const linkBtn: React.CSSProperties = {
  marginTop: 22,
  padding: "12px 22px",
  borderRadius: 12,
  background: "linear-gradient(180deg,#7a68ff,#5847e6)",
  border: "1px solid #9f92ff55",
  color: "#fff",
  fontWeight: 800,
  fontSize: 15.5,
  textDecoration: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16), 0 3px 10px rgba(0,0,0,0.35)",
};
