"use client";

// 테스트(시나리오 연습) 모드 입구 — 기억하기 쉬운 8자리 코드로 진입.
// 모든 동작은 브라우저 로컬 샌드박스에서만 일어나며 실제 행사 데이터와 완전히 분리된다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { isTestAuthed, authTest, simPost } from "@/lib/simRaffle";

export default function TestGate() {
  const [authed, setAuthed] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setAuthed(isTestAuthed());
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (authTest(code)) {
      setAuthed(true);
      setMsg("");
    } else {
      setMsg("코드가 틀렸습니다.");
    }
  }

  if (!authed) {
    return (
      <main style={wrap}>
        <h1 style={h1}>🧪 시나리오 테스트 모드</h1>
        <p style={{ opacity: 0.65, marginTop: 10, lineHeight: 1.7 }}>
          도우미용 연습 공간입니다. 테스트 코드(8자리)를 입력하세요.
          <br />여기서 하는 모든 조작은 <b>이 컴퓨터 안에서만</b> 동작하며 실제 행사에
          아무 영향을 주지 않습니다.
        </p>
        <form onSubmit={submit}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="테스트 코드"
            maxLength={16}
            style={{ ...input, textAlign: "center", letterSpacing: 4, textTransform: "uppercase" }}
          />
          <button type="submit" style={btn("#6d5cff")}>입장</button>
        </form>
        {msg && <p style={{ marginTop: 12, color: "#ff6b6b" }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={h1}>🧪 시나리오 테스트 모드</h1>
      <p style={{ opacity: 0.65, marginTop: 10, lineHeight: 1.7, fontSize: 14 }}>
        실제와 똑같은 화면으로 전체 시나리오를 연습합니다:
        <b> 가상 응모 투입 → 마감 → 항아리 흔들기 → 추첨 → 추가 추첨 → 명단 공개 → 리셋</b>.
        <br />같은 컴퓨터에서 아래 창들을 함께 열면 서로 실시간 동기화됩니다.
        실제 행사 데이터와는 완전히 분리되어 있습니다.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        <Link href="/test/stage" target="_blank" style={{ ...btn("#1e3a5f"), textAlign: "center", textDecoration: "none", display: "block" }}>
          ① 무대 화면 열기 (새 창 — 프로젝터 역할)
        </Link>
        <Link href="/test/control" target="_blank" style={{ ...btn("#059669"), textAlign: "center", textDecoration: "none", display: "block" }}>
          ② 관리자 리모컨 열기 (새 창 — 진행 조작)
        </Link>
        <Link href="/test/enter" target="_blank" style={{ ...btn("#3a3a4a"), textAlign: "center", textDecoration: "none", display: "block" }}>
          ③ 응모 화면 열기 (새 창 — 관중 역할, 선택)
        </Link>
      </div>

      <div style={{ marginTop: 24, padding: 14, borderRadius: 12, background: "#141420", border: "1px solid #24242f", fontSize: 13, opacity: 0.75, lineHeight: 1.7 }}>
        추천 순서: 리모컨에서 <b>가상 응모 투입(20/100/300명)</b> → 무대에 버블이 쌓이는 것
        확인 → <b>응모 마감</b> → <b>추첨 시작</b> → 병이 뒤집히면 <b>코르크 열기</b> →
        탈락 배출 후 <b>명단 공개</b> → <b>추가 추첨</b> → <b>전체 리셋</b>으로 마무리.
      </div>

      <button
        style={{ ...btn("#7f1d1d"), marginTop: 24 }}
        onClick={async () => {
          if (!confirm("테스트 샌드박스를 초기화합니다. (이 컴퓨터의 연습 데이터만)")) return;
          await simPost("/api/reset", { confirm: "RESET", force: true });
          setMsg("샌드박스 초기화 완료");
        }}
      >
        샌드박스 초기화
      </button>
      {msg && <p style={{ marginTop: 12, opacity: 0.8 }}>{msg}</p>}
    </main>
  );
}

const wrap: React.CSSProperties = { maxWidth: 460, margin: "0 auto", padding: 24, minHeight: "100dvh" };
const h1: React.CSSProperties = { fontSize: 22, fontWeight: 800 };
const input: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  padding: "14px 16px",
  fontSize: 18,
  borderRadius: 12,
  border: "1px solid #2a2a35",
  background: "#15151d",
  color: "#fff",
};
function btn(bg: string): React.CSSProperties {
  return { marginTop: 12, padding: "16px", fontSize: 16, fontWeight: 700, borderRadius: 12, border: "none", background: bg, color: "#fff", cursor: "pointer", width: "100%" };
}
