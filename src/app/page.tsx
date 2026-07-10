import Link from "next/link";

// 통합 입구 — 링크 하나(도메인 루트)로 세 가지 모드를 선택한다.
// ① 번호표 추첨(브라우저 로컬) ② QR 유리병 추첨(서버) ③ 시나리오 테스트(브라우저 로컬 샌드박스)
export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 560, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center" }}>현장 추첨</h1>
      <p style={{ opacity: 0.6, marginTop: 8, textAlign: "center", fontSize: 14 }}>
        모드를 선택하세요. 참여자에게는 무대 화면의 QR만 노출됩니다.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 28 }}>
        <Link href="/numbers/admin" style={card("#2a2555", "#8f7bff")}>
          <div style={cardTitle}>① 번호표 추첨</div>
          <div style={cardDesc}>
            종이 번호표(1~N) 배부 후 화면에 랜덤 번호 표출.
            서버 불필요 — 이 컴퓨터 안에서만 동작.
          </div>
          <div style={cardLinks}>관리자 화면으로 이동 (슬라이드쇼 창은 그 안에서 열기)</div>
        </Link>

        <Link href="/stage" style={card("#0f2e22", "#34d399")}>
          <div style={cardTitle}>② QR 유리병 추첨</div>
          <div style={cardDesc}>
            관중이 QR로 응모 → 유리병 버블 연출 → 물리 추첨.
            무대(프로젝터)는 여기, 진행은 관리자 리모컨(/control, 토큰 필요)에서.
          </div>
          <div style={cardLinks}>무대 화면으로 이동 · 리모컨: /control · 응모: /enter</div>
        </Link>

        <Link href="/test" style={card("#2e1214", "#fca5a5")}>
          <div style={cardTitle}>③ 시나리오 테스트 🧪</div>
          <div style={cardDesc}>
            도우미 연습용 샌드박스(테스트 코드 필요). 실제와 같은 화면으로
            전체 시나리오를 연습 — 실제 행사 데이터와 완전 분리.
          </div>
          <div style={cardLinks}>테스트 입구로 이동 (/test)</div>
        </Link>
      </div>
    </main>
  );
}

function card(bg: string, accent: string): React.CSSProperties {
  return {
    display: "block",
    padding: "18px 20px",
    borderRadius: 16,
    background: bg,
    border: `1px solid ${accent}44`,
    color: "#fff",
    textDecoration: "none",
  };
}
const cardTitle: React.CSSProperties = { fontSize: 19, fontWeight: 800 };
const cardDesc: React.CSSProperties = { fontSize: 13.5, opacity: 0.75, marginTop: 6, lineHeight: 1.6 };
const cardLinks: React.CSSProperties = { fontSize: 12.5, opacity: 0.55, marginTop: 8 };
