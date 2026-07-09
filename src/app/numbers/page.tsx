"use client";

import { useEffect } from "react";

export default function NumbersIndex() {
  useEffect(() => {
    window.location.replace("/numbers/admin");
  }, []);
  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", color: "#8f7bff" }}>
      <a href="/numbers/admin" style={{ color: "#8f7bff", fontSize: 20 }}>번호 추첨 관리자로 이동…</a>
    </main>
  );
}
