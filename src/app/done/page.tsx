export default function DonePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 64 }}>🎉</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 16 }}>
        응모가 완료되었습니다
      </h1>
      <p style={{ opacity: 0.65, marginTop: 12, fontSize: 16, lineHeight: 1.6 }}>
        추첨 결과는 무대 화면에서 발표됩니다.
        <br />
        이 화면은 닫으셔도 됩니다.
      </p>
    </main>
  );
}
