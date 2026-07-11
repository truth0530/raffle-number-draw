"use client";

// 응모 화면 공용 컴포넌트 — 실제 운영(/enter, 서버 API)과 테스트 샌드박스(/test/enter,
// 브라우저 로컬)가 이 한 파일을 공유한다. 차이는 전송 계층(mode)뿐.
//
// 씬을 폴링해 마감되면 폼을 잠근다 — 다 입력하고 제출한 뒤에야 "마감"을 알게 되는
// 헛수고 방지. 응모 성공 시 이 폰에 내역을 저장해 /done에서 내 결과를 실시간 확인.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { simPost, simGetState, simGetEntries } from "@/lib/simRaffle";
import { addMyEntry, loadMyEntries } from "@/lib/myEntries";

function fetchT(url: string, ms = 4000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { cache: "no-store", signal: c.signal }).finally(() => clearTimeout(t));
}

export default function EnterView({ mode }: { mode: "live" | "test" }) {
  const isTest = mode === "test";
  const router = useRouter();
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<string | null>(null);
  const [mineCount, setMineCount] = useState(0);
  const stopped = useRef(false);

  const doneHref = isTest ? "/test/enter/done" : "/done";

  // "이 폰으로 N명 응모됨" 배지는 서버에 실제 남아 있는 응모만 센다 — 리셋된 옛 세대의
  // localStorage 유령 기록을 세면(예: 1차 응모 폰이 2차에 재방문) 응모 안 한 사람을
  // 응모한 것처럼 오인시킨다(사용자 지적 #1). /done의 stale 판정과 동일한 근거(서버 존재).
  useEffect(() => {
    let cancelled = false;
    async function count() {
      const mine = loadMyEntries(mode);
      const myIds = mine.map((e) => e.entryId).filter((id): id is string => !!id);
      try {
        const ents = isTest
          ? ((await simGetEntries()) as unknown as { ok: boolean; entries: { id: string }[] })
          : ((await (await fetchT("/api/entries")).json()) as { ok: boolean; entries: { id: string }[] });
        if (cancelled) return;
        if (ents.ok && myIds.length > 0) {
          const serverIds = new Set(ents.entries.map((e) => e.id));
          setMineCount(myIds.filter((id) => serverIds.has(id)).length);
        } else {
          // 서버 목록을 못 받으면(오프라인 등) 옛 로컬 수치로 폴백(fail-safe: 과다표시 감수).
          setMineCount(mine.length);
        }
      } catch {
        if (!cancelled) setMineCount(loadMyEntries(mode).length);
      }
    }
    count();
    return () => {
      cancelled = true;
    };
  }, [mode, isTest]);

  // 씬 폴링 — 마감(FROZEN 이후)이면 입력 전에 알려준다. 실패 시 폼 유지(fail-open).
  useEffect(() => {
    stopped.current = false;
    async function poll() {
      while (!stopped.current) {
        try {
          let s: { ok?: boolean; scene?: string };
          if (isTest) {
            s = (await simGetState()) as { ok?: boolean; scene?: string };
          } else {
            const res = await fetchT("/api/state");
            s = await res.json();
          }
          if (s.ok && s.scene) setScene(s.scene);
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
  }, [isTest]);

  const closed = scene === "FROZEN" || scene === "DRAWING" || scene === "WINNERS";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const cleanName = name.normalize("NFC").replace(/\s+/g, " ").trim();
    const cleanLast4 = last4.replace(/\D/g, "");
    if (cleanName.length < 1) return setError("이름을 입력해 주세요.");
    if (cleanLast4.length !== 4) return setError("휴대전화 뒤 4자리를 정확히 입력해 주세요.");

    setBusy(true);
    try {
      let status = 0;
      let data: { ok?: boolean; error?: string; duplicate?: boolean; entryId?: string | null } = {};
      // 수백 명이 동시에 몰리면 순간적인 서버/DB 블립이 날 수 있다 — 5xx·네트워크 오류는
      // 최대 3회 자동 재시도해 관중이 직접 여러 번 누르지 않아도 응모가 들어가게 한다.
      // 같은 이름+뒤4자리는 서버가 멱등 처리(중복=성공)하므로 재시도해도 이중 응모가 아니다.
      let networkErr = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (isTest) {
            const r = await simPost("/api/enter", { name: cleanName, last4: cleanLast4 });
            status = r.status;
            data = r.data as typeof data;
          } else {
            // 현장 wifi에서 요청이 pending으로 매달리면 "전송 중…"에 영구 고착된다 — 10초 타임아웃.
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 10000);
            const res = await fetch("/api/enter", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: cleanName, last4: cleanLast4 }),
              signal: ctrl.signal,
            }).finally(() => clearTimeout(timer));
            status = res.status;
            data = await res.json();
          }
          networkErr = false;
          if (status < 500) break; // 성공 또는 4xx(마감·형식오류 등) → 재시도 불필요
        } catch {
          networkErr = true; // 타임아웃/네트워크 → 재시도
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
      if (networkErr) throw new Error("network");
      if (status === 200 && data.ok) {
        // 이 폰의 응모 내역으로 저장 → /done에서 내 결과 실시간 확인.
        // duplicate(이미 같은 이름+뒤4자리 존재)도 같은 응모로 간주해 결과 화면으로.
        addMyEntry(mode, {
          entryId: data.entryId ?? null,
          name: cleanName,
          last4: cleanLast4,
          at: new Date().toISOString(),
        });
        router.replace(doneHref);
        return;
      }
      if (status === 409 && data.error === "closed") {
        setScene("FROZEN");
        setError("응모가 마감되었습니다.");
      } else if (data.error === "invalid_last4") {
        setError("휴대전화 뒤 4자리를 정확히 입력해 주세요.");
      } else if (data.error === "invalid_name") {
        setError("이름을 확인해 주세요.");
      } else if (status === 429) {
        setError("잠시 후 다시 시도해 주세요.");
      } else {
        setError("전송에 실패했습니다. 다시 시도해 주세요.");
      }
    } catch {
      setError("네트워크 오류입니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  // 마감 이후 — 폼 대신 명확한 안내 (입력 헛수고 방지)
  if (closed) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 25, fontWeight: 800, textAlign: "center", marginTop: 14 }}>
          응모가 마감되었습니다
        </h1>
        <p style={{ textAlign: "center", opacity: 0.7, marginTop: 12, fontSize: 15.5, lineHeight: 1.65 }}>
          {scene === "WINNERS" ? "당첨자 명단이 공개되었습니다." : "곧 추첨이 시작됩니다. 무대 화면을 봐주세요!"}
        </p>
        {mineCount > 0 && (
          <Link href={doneHref} style={resultLink}>
            내 응모 결과 보기 →
          </Link>
        )}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 27, fontWeight: 800, textAlign: "center" }}>
        추첨 응모{isTest && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 800, background: "#7f1d1d", padding: "3px 10px", borderRadius: 8, verticalAlign: "middle" }}>테스트</span>}
      </h1>
      <p style={{ textAlign: "center", opacity: 0.7, marginTop: 8, marginBottom: 8, fontSize: 16 }}>
        이름과 휴대전화 뒤 4자리를 입력하세요.
      </p>

      {/* 이미 이 폰으로 응모한 경우 — 중복 응모 착각 방지 + 결과 화면 안내 */}
      {mineCount > 0 && (
        <Link href={doneHref} style={{ ...resultLink, marginTop: 4, marginBottom: 10, fontSize: 14, padding: "10px 16px" }}>
          이 폰으로 {mineCount}명 응모됨 — 내 결과 보기 →
        </Link>
      )}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 16, opacity: 0.85, fontWeight: 600 }}>이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            enterKeyHint="next"
            style={inputStyle}
            placeholder="홍길동"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 16, opacity: 0.85, fontWeight: 600 }}>휴대전화 뒤 4자리</span>
          <input
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            enterKeyHint="done"
            style={{ ...inputStyle, letterSpacing: 10, textAlign: "center", fontSize: 26 }}
            placeholder="0000"
          />
        </label>

        {error && (
          <div style={{ color: "#ff6b6b", fontSize: 15.5, textAlign: "center", fontWeight: 600 }}>{error}</div>
        )}

        <button type="submit" disabled={busy} style={buttonStyle(busy)}>
          {busy ? "전송 중…" : "응모하기"}
        </button>

        <p style={{ fontSize: 12.5, opacity: 0.5, textAlign: "center", lineHeight: 1.6 }}>
          입력하신 정보(이름·전화 뒤 4자리)는 본 경품 추첨 운영과 당첨자 확인에만
          사용되며, 행사 종료 후 지체 없이 파기됩니다.
        </p>
      </form>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  padding: 24,
  maxWidth: 460,
  margin: "0 auto",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "17px 18px",
  fontSize: 19,
  borderRadius: 14,
  border: "1px solid #2a2a35",
  background: "#15151d",
  color: "#fff",
  outline: "none",
};

const resultLink: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  marginTop: 22,
  padding: "13px 22px",
  borderRadius: 10,
  background: "rgba(109,92,255,0.14)",
  border: "1px solid rgba(109,92,255,0.45)",
  color: "#c9c2ff",
  fontWeight: 700,
  fontSize: 15.5,
  textDecoration: "none",
};

function buttonStyle(busy: boolean): React.CSSProperties {
  return {
    marginTop: 8,
    padding: "17px",
    fontSize: 19,
    fontWeight: 700,
    borderRadius: 12,
    border: "none",
    background: busy ? "#2c2c38" : "#6d5cff",
    color: busy ? "#8c8c9a" : "#fff",
    cursor: busy ? "default" : "pointer",
  };
}
