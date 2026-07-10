"use client";

import StageView from "@/app/stage/StageView";
import TestGuard from "../TestGuard";

// 테스트 무대 — 실제 무대와 같은 컴포넌트, 데이터만 브라우저 로컬 샌드박스.
export default function TestStagePage() {
  return (
    <TestGuard>
      <StageView mode="test" />
    </TestGuard>
  );
}
