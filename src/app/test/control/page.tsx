"use client";

import ControlView from "@/app/control/ControlView";
import TestGuard from "../TestGuard";

// 테스트 리모컨 — 실제 리모컨과 같은 컴포넌트, 토큰 불필요·데이터는 브라우저 로컬.
export default function TestControlPage() {
  return (
    <TestGuard>
      <ControlView mode="test" />
    </TestGuard>
  );
}
