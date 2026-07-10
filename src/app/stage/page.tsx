"use client";

import StageView from "./StageView";

// 실제 운영 무대 — 로직은 StageView(테스트 샌드박스와 공유)에 있다.
export default function StagePage() {
  return <StageView mode="live" />;
}
