"use client";

// 테스트 하위 페이지 공용 가드 — 코드 미입력 시 /test 입구로 돌려보낸다.

import { useEffect, useState } from "react";
import { isTestAuthed } from "@/lib/simRaffle";

export default function TestGuard({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (isTestAuthed()) setOk(true);
    else window.location.replace("/test");
  }, []);
  if (!ok) {
    return (
      <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", color: "#8f7bff" }}>
        테스트 코드 확인 중…
      </main>
    );
  }
  return <>{children}</>;
}
