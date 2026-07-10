"use client";

import DoneView from "@/app/done/DoneView";
import TestGuard from "../../TestGuard";

// 테스트 응모 완료 — 실제 /done과 같은 컴포넌트, 데이터만 브라우저 로컬 샌드박스.
export default function TestDonePage() {
  return (
    <TestGuard>
      <DoneView mode="test" />
    </TestGuard>
  );
}
