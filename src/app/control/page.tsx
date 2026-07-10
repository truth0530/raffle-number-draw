"use client";

import ControlView from "./ControlView";

// 실제 운영 리모컨 — 로직은 ControlView(테스트 샌드박스와 공유)에 있다.
export default function ControlPage() {
  return <ControlView mode="live" />;
}
