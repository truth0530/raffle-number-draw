// S1 검증 게이트 (재현 가능한 e2e). 실행 중인 서버에 대해 전체 시나리오를 검사.
// 사용: (dev 서버 실행 후) node scripts/gate.mjs
// 환경: BASE_URL(기본 http://localhost:3000), ADMIN_TOKEN(기본 dev-local-token-change-me)
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-local-token-change-me";

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? "  → " + detail : ""}`);
  }
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-admin-token"] = token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`GATE against ${BASE}`);

  // 0) 깨끗한 상태로 리셋
  await api("/api/reset", { method: "POST", body: { confirm: "RESET", force: true }, token: TOKEN });

  // 1) 초기 상태
  let s = await api("/api/state");
  check("초기 씬 QR", s.json?.scene === "QR", s.json?.scene);
  check("초기 응모 0", s.json?.entryCount === 0, String(s.json?.entryCount));
  check("초기 winners 빈 배열", Array.isArray(s.json?.winners) && s.json.winners.length === 0);

  // 2) 응모 30명 + 중복 1건
  for (let i = 0; i < 30; i++) {
    await api("/api/enter", { method: "POST", body: { name: `테스트${i}`, last4: String(1000 + i) } });
  }
  const dup = await api("/api/enter", { method: "POST", body: { name: "테스트0", last4: "1000" } });
  check("중복 응모 = 멱등 성공(duplicate:true)", dup.json?.ok === true && dup.json?.duplicate === true, JSON.stringify(dup.json));

  s = await api("/api/state");
  check("중복 제거 후 응모 30명", s.json?.entryCount === 30, String(s.json?.entryCount));
  check("충돌 시도 1건 카운트 노출(분쟁 대응)", s.json?.collisionCount === 1, String(s.json?.collisionCount));

  // 2.5) 공개 응모 목록에 개인정보(last4) 미노출
  const ent = await api("/api/entries");
  const entList = ent.json?.entries ?? [];
  check("응모 목록 30명 제공", entList.length === 30, String(entList.length));
  check(
    "응모 목록에 last4 미노출(개인정보)",
    entList.every((e) => !("last4" in e) && typeof e.id === "string" && typeof e.name === "string"),
    JSON.stringify(entList[0])
  );

  // 2.7) 리허설: 가상 응모 투입/선별 삭제(관리자 전용)
  const noTokenSeed = await api("/api/rehearsal", { method: "POST", body: { action: "seed", count: 20 } });
  check("토큰 없는 리허설 401", noTokenSeed.status === 401, String(noTokenSeed.status));
  const seed = await api("/api/rehearsal", { method: "POST", body: { action: "seed", count: 20 }, token: TOKEN });
  check("가상 응모 20명 투입", seed.json?.ok === true && seed.json?.seeded === 20, JSON.stringify(seed.json));
  s = await api("/api/state");
  check("투입 후 총 50명", s.json?.entryCount === 50, String(s.json?.entryCount));
  check("state에 가상 응모 수 노출(잔존 경고용)", s.json?.rehearsalCount === 20, String(s.json?.rehearsalCount));
  const clear = await api("/api/rehearsal", { method: "POST", body: { action: "clear" }, token: TOKEN });
  check("가상 응모만 삭제(20명)", clear.json?.ok === true && clear.json?.deleted === 20, JSON.stringify(clear.json));
  s = await api("/api/state");
  check("삭제 후 실제 응모 30명 유지", s.json?.entryCount === 30, String(s.json?.entryCount));

  // 3) 잘못된 입력 거부
  const badLast4 = await api("/api/enter", { method: "POST", body: { name: "홍길동", last4: "12" } });
  check("뒤4자리 오류 422", badLast4.status === 422, String(badLast4.status));

  // 4) 사전 유출 차단: 비공개 씬에서 winners 미포함
  check("추첨 전 winners 노출 안됨", (s.json?.winners ?? []).length === 0);

  // 5) 씬 전이 + 마감 후 접수 거부
  const t1 = await api("/api/scene", { method: "POST", body: { to: "COLLECTING" }, token: TOKEN });
  check("QR→COLLECTING 허용", t1.json?.ok === true, JSON.stringify(t1.json));
  const t2 = await api("/api/scene", { method: "POST", body: { to: "FROZEN" }, token: TOKEN });
  check("COLLECTING→FROZEN 허용", t2.json?.ok === true, JSON.stringify(t2.json));

  const afterFreeze = await api("/api/enter", { method: "POST", body: { name: "지각생", last4: "9999" } });
  check("마감 후 응모 거부 409", afterFreeze.status === 409, String(afterFreeze.status));
  const seedFrozen = await api("/api/rehearsal", { method: "POST", body: { action: "seed", count: 5 }, token: TOKEN });
  check("마감 후 가상 응모 거부 409", seedFrozen.status === 409, String(seedFrozen.status));

  // 5.5) 조기 마감 복구: FROZEN→COLLECTING 재개 → 응모 다시 열림 → 재마감
  const reopen = await api("/api/scene", { method: "POST", body: { to: "COLLECTING" }, token: TOKEN });
  check("마감 취소(FROZEN→COLLECTING) 허용", reopen.json?.ok === true, JSON.stringify(reopen.json));
  s = await api("/api/state");
  check("재개 후 frozenAt 해제", s.json?.frozenAt === null, String(s.json?.frozenAt));
  const reopenEnter = await api("/api/enter", { method: "POST", body: { name: "재개확인", last4: "8888" } });
  check("재개 후 응모 다시 허용", reopenEnter.json?.ok === true, JSON.stringify(reopenEnter.json));
  const refreeze = await api("/api/scene", { method: "POST", body: { to: "FROZEN" }, token: TOKEN });
  check("재마감 허용", refreeze.json?.ok === true, JSON.stringify(refreeze.json));

  // 6) 불법 전이 거부
  const illegal = await api("/api/scene", { method: "POST", body: { to: "WINNERS" }, token: TOKEN });
  check("FROZEN→WINNERS 불법전이 거부 409", illegal.status === 409, String(illegal.status));

  // 7) 토큰 없는 변경요청 401
  const noToken = await api("/api/scene", { method: "POST", body: { to: "DRAWING" } });
  check("토큰 없는 scene 변경 401", noToken.status === 401, String(noToken.status));
  const noTokenDraw = await api("/api/draw", { method: "POST", body: { count: 5 } });
  check("토큰 없는 draw 401", noTokenDraw.status === 401, String(noTokenDraw.status));

  // 8) 추첨 20명 (트랜잭션, 정확히 20명 distinct)
  const d1 = await api("/api/draw", { method: "POST", body: { count: 20 }, token: TOKEN });
  check("추첨 20명 성공", d1.json?.ok === true && d1.json?.drawn === 20, JSON.stringify(d1.json?.drawn));
  const w1 = new Set((d1.json?.newWinners ?? []).map((w) => `${w.name}|${w.last4}`));
  check("추첨 20명 전원 distinct", w1.size === 20, String(w1.size));

  s = await api("/api/state");
  check("추첨 후 씬 DRAWING", s.json?.scene === "DRAWING", s.json?.scene);
  check("공개 씬에서 winners 20명 노출", (s.json?.winners ?? []).length === 20, String(s.json?.winners?.length));
  check(
    "winners 에 entryId 포함(무대 버블 매칭용)",
    (s.json?.winners ?? []).every((w) => typeof w.entryId === "string" && w.entryId.length > 0),
    JSON.stringify(s.json?.winners?.[0])
  );

  // 9) 추가 추첨 3명 → 총 23명, 기존과 미중복
  const d2 = await api("/api/draw", { method: "POST", body: { count: 3 }, token: TOKEN });
  check("추가추첨 3명 성공", d2.json?.ok === true && d2.json?.drawn === 3, JSON.stringify(d2.json?.drawn));

  s = await api("/api/state");
  const all = s.json?.winners ?? [];
  const allKeys = new Set(all.map((w) => `${w.name}|${w.last4}`));
  check("총 당첨 23명", all.length === 23, String(all.length));
  check("23명 전원 distinct(추가추첨 미중복)", allKeys.size === 23, String(allKeys.size));
  const ranks = all.map((w) => w.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  check("rank 1..23 연속", ranksOk, ranks.join(","));

  // 9.5) 추첨 시작 후에는 가상 응모 선별 삭제 금지(명단 뒤섞임 방지)
  const clearLive = await api("/api/rehearsal", { method: "POST", body: { action: "clear" }, token: TOKEN });
  check("추첨 중 가상 응모 삭제 잠금 423", clearLive.status === 423, String(clearLive.status));

  // 10) 명단 공개 전이
  const rev = await api("/api/scene", { method: "POST", body: { to: "WINNERS" }, token: TOKEN });
  check("DRAWING→WINNERS 허용", rev.json?.ok === true, JSON.stringify(rev.json));

  // 11) 리셋 안전장치
  const noConfirm = await api("/api/reset", { method: "POST", body: {}, token: TOKEN });
  check("confirm 없는 리셋 거부 400", noConfirm.status === 400, String(noConfirm.status));
  const liveLock = await api("/api/reset", { method: "POST", body: { confirm: "RESET" }, token: TOKEN });
  check("라이브(WINNERS) 리셋 잠금 423", liveLock.status === 423, String(liveLock.status));
  const forced = await api("/api/reset", { method: "POST", body: { confirm: "RESET", force: true }, token: TOKEN });
  check("force 리셋 성공 + 스냅샷", forced.json?.ok === true && !!forced.json?.snapshot, JSON.stringify(forced.json?.snapshot));
  check(
    "리셋 응답에 스냅샷 데이터 포함(브라우저 백업용)",
    (forced.json?.snapshotData?.entries ?? []).length === 31 &&
      (forced.json?.snapshotData?.winners ?? []).length === 23,
    `entries=${forced.json?.snapshotData?.entries?.length} winners=${forced.json?.snapshotData?.winners?.length}`
  );

  s = await api("/api/state");
  check("리셋 후 씬 QR", s.json?.scene === "QR", s.json?.scene);
  check("리셋 후 응모 0", s.json?.entryCount === 0, String(s.json?.entryCount));

  // 12) 응모 0명 추첨 거부(무대 교착 방지) — 빈 DB로 FROZEN까지 가서 확인
  await api("/api/scene", { method: "POST", body: { to: "COLLECTING" }, token: TOKEN });
  await api("/api/scene", { method: "POST", body: { to: "FROZEN" }, token: TOKEN });
  const empty = await api("/api/draw", { method: "POST", body: { count: 5 }, token: TOKEN });
  check("응모 0명 추첨 거부 409(no_candidates)", empty.status === 409 && empty.json?.error === "no_candidates", `${empty.status} ${empty.json?.error}`);
  s = await api("/api/state");
  check("거부 후 씬 FROZEN 유지(교착 없음)", s.json?.scene === "FROZEN", s.json?.scene);
  const finalReset = await api("/api/reset", { method: "POST", body: { confirm: "RESET" }, token: TOKEN });
  check("최종 리셋 → 클린 종료", finalReset.json?.ok === true, JSON.stringify(finalReset.json?.cleared));

  console.log(`\nGATE: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("GATE ERROR", e);
  process.exit(1);
});
