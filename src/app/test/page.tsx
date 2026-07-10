"use client";

// 테스트(시나리오 연습) 모드 입구 — 기억하기 쉬운 8자리 코드로 진입.
// 모든 동작은 브라우저 로컬 샌드박스에서만 일어나며 실제 행사 데이터와 완전히 분리된다.
// 진입 후에는 리모컨 하나만 열면 된다 — 무대 창은 리모컨 상단 [무대 화면 ↗]로 연다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { isTestAuthed, authTest, simPost } from "@/lib/simRaffle";
import { btn, ghostDanger, panel, inputBase } from "@/lib/ui";

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
            style={{ ...inputBase, width: "100%", marginTop: 16, padding: "14px 16px", fontSize: 18, textAlign: "center", letterSpacing: 4, textTransform: "uppercase" }}
          />
          <button type="submit" style={{ ...btn("violet", { size: "lg" }), marginTop: 12 }}>입장</button>
        </form>
        {msg && <p style={{ marginTop: 12, color: "#ff6b6b" }}>{msg}</p>}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={h1}>🧪 시나리오 테스트 모드</h1>
      <p style={{ opacity: 0.65, marginTop: 10, lineHeight: 1.7, fontSize: 14 }}>
        실제와 똑같은 화면으로 전체 시나리오를 연습합니다. 진행은 <b>리모컨 하나</b>로
        충분합니다 — 무대(프로젝터) 창은 리모컨 안의 <b>[무대 화면 ↗]</b> 버튼으로 엽니다.
      </p>

      <Link href="/test/control" target="_blank" style={{ ...btn("green", { size: "lg" }), marginTop: 18, textAlign: "center", textDecoration: "none", display: "block" }}>
        관리자 리모컨 열기 — 여기서 전부 진행
      </Link>
      <Link href="/test/enter" target="_blank" style={{ ...btn("slate", { size: "sm" }), marginTop: 8, textAlign: "center", textDecoration: "none", display: "block", opacity: 0.85 }}>
        응모 화면 열기 (관중 역할 체험 · 선택)
      </Link>

      <div style={{ ...panel, marginTop: 18, fontSize: 13, opacity: 0.75, lineHeight: 1.8 }}>
        추천 순서: 리모컨에서 <b>[무대 화면 ↗]</b>로 무대 창 열기 → <b>가상 응모 투입
        (20/100/300명)</b> → 무대에 버블이 쌓이는 것 확인 → <b>응모 마감</b> →
        <b> 추첨 시작</b> → 병이 뒤집히면 <b>코르크 열기</b> → 탈락 배출 후
        <b> 명단 공개</b> → <b>추가 추첨</b> → <b>전체 리셋</b>으로 마무리.
      </div>

      <button
        style={{ ...ghostDanger, marginTop: 18 }}
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
