"use client";

import Link from "next/link";

// 테스트 응모 완료 — 실제 /done과 동일한 안내 + 테스트 표식.
export default function TestDonePage() {
  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 64 }}>🎉</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 16 }}>
        응모 완료 <span style={{ fontSize: 13, fontWeight: 800, background: "#7f1d1d", padding: "3px 10px", borderRadius: 8, verticalAlign: "middle" }}>🧪 테스트</span>
      </h1>
      <p style={{ opacity: 0.65, marginTop: 10 }}>테스트 무대 화면에 버블이 나타났는지 확인해 보세요.</p>
      <Link href="/test/enter" style={{ marginTop: 24, color: "#8f7bff" }}>다른 이름으로 또 응모하기</Link>
    </main>
  );
}
