"use client";

// 응모 화면 공용 컴포넌트 — 실제 운영(/enter, 서버 API)과 테스트 샌드박스(/test/enter,
// 브라우저 로컬)가 이 한 파일을 공유한다. 차이는 전송 계층(mode)뿐.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { simPost } from "@/lib/simRaffle";

export default function EnterView({ mode }: { mode: "live" | "test" }) {
  const isTest = mode === "test";
  const router = useRouter();
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      let status: number;
      let data: { ok?: boolean; error?: string };
      if (isTest) {
        // 테스트 샌드박스: 같은 컴퓨터의 무대/리모컨 창과 로컬로 동기화.
        const r = await simPost("/api/enter", { name: cleanName, last4: cleanLast4 });
        status = r.status;
        data = r.data as { ok?: boolean; error?: string };
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
      if (status === 200 && data.ok) {
        router.replace(isTest ? "/test/enter/done" : "/done");
        return;
      }
      if (status === 409 && data.error === "closed") {
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

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 24,
        maxWidth: 460,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center" }}>
        추첨 응모{isTest && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 800, background: "#7f1d1d", padding: "3px 10px", borderRadius: 8, verticalAlign: "middle" }}>🧪 테스트</span>}
      </h1>
      <p style={{ textAlign: "center", opacity: 0.65, marginTop: 8, marginBottom: 28 }}>
        이름과 휴대전화 뒤 4자리를 입력하세요.
      </p>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 15, opacity: 0.8 }}>이름</span>
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
          <span style={{ fontSize: 15, opacity: 0.8 }}>휴대전화 뒤 4자리</span>
          <input
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            enterKeyHint="done"
            style={{ ...inputStyle, letterSpacing: 8, textAlign: "center", fontSize: 24 }}
            placeholder="0000"
          />
        </label>

        {error && (
          <div style={{ color: "#ff6b6b", fontSize: 15, textAlign: "center" }}>{error}</div>
        )}

        <button type="submit" disabled={busy} style={buttonStyle(busy)}>
          {busy ? "전송 중…" : "응모하기"}
        </button>

        <p style={{ fontSize: 12, opacity: 0.5, textAlign: "center", lineHeight: 1.6 }}>
          입력하신 정보(이름·전화 뒤 4자리)는 본 경품 추첨 운영과 당첨자 확인에만
          사용되며, 행사 종료 후 지체 없이 파기됩니다.
        </p>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "16px 18px",
  fontSize: 18,
  borderRadius: 14,
  border: "1px solid #2a2a35",
  background: "#15151d",
  color: "#fff",
  outline: "none",
};

function buttonStyle(busy: boolean): React.CSSProperties {
  return {
    marginTop: 8,
    padding: "18px",
    fontSize: 19,
    fontWeight: 700,
    borderRadius: 14,
    border: "none",
    background: busy ? "#3a3a4a" : "#6d5cff",
    color: "#fff",
    cursor: busy ? "default" : "pointer",
  };
}
