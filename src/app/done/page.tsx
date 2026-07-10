"use client";

import DoneView from "./DoneView";

// 실제 응모 완료 — 내 결과 실시간 확인은 DoneView(테스트와 공유)에 있다.
export default function DonePage() {
  return <DoneView mode="live" />;
}
