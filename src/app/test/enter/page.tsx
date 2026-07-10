"use client";

import EnterView from "@/app/enter/EnterView";
import TestGuard from "../TestGuard";

// 테스트 응모 — 같은 컴퓨터의 테스트 무대/리모컨과 로컬로 동기화.
export default function TestEnterPage() {
  return (
    <TestGuard>
      <EnterView mode="test" />
    </TestGuard>
  );
}
