"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function EnterPage() {
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
      const res = await fetch("/api/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName, last4: cleanLast4 }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.replace("/done");
        return;
      }
      if (res.status === 409 && data.error === "closed") {
        setError("응모가 마감되었습니다.");
      } else if (data.error === "invalid_last4") {
        setError("휴대전화 뒤 4자리를 정확히 입력해 주세요.");
      } else if (data.error === "invalid_name") {
        setError("이름을 확인해 주세요.");
      } else if (res.status === 429) {
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
        추첨 응모
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
