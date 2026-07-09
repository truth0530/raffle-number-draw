import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>현장 추첨</h1>
      <p style={{ opacity: 0.7, marginTop: 8 }}>
        아래는 운영용 링크입니다. 참여자에게는 QR(무대 화면)만 노출하세요.
      </p>
      <ul style={{ marginTop: 24, lineHeight: 2 }}>
        <li>
          <Link href="/enter">참여자 응모 페이지 (/enter)</Link>
        </li>
        <li>
          <Link href="/stage">무대 화면 (/stage) — 방송실 크롬 F11</Link>
        </li>
        <li>
          <Link href="/control">관리자 리모컨 (/control) — 토큰 필요</Link>
        </li>
      </ul>
    </main>
  );
}
