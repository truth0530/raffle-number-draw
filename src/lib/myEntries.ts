// 이 폰에서 응모한 내역(localStorage) — 응모 완료 화면의 "내 결과" 확인용.
// 가족이 폰 하나로 여러 명 응모하는 경우를 위해 배열로 보관한다(최대 8명).

export type MyEntry = { entryId: string | null; name: string; last4: string; at: string };

const key = (mode: "live" | "test") =>
  mode === "test" ? "raffle_my_entries_test" : "raffle_my_entries";

export function loadMyEntries(mode: "live" | "test"): MyEntry[] {
  try {
    const raw = localStorage.getItem(key(mode));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((e) => e && e.name && e.last4) : [];
  } catch {
    return [];
  }
}

export function addMyEntry(mode: "live" | "test", e: MyEntry): void {
  const list = loadMyEntries(mode).filter(
    (x) => !(x.name === e.name && x.last4 === e.last4)
  );
  list.push(e);
  try {
    localStorage.setItem(key(mode), JSON.stringify(list.slice(-8)));
  } catch {
    /* 저장 실패해도 응모 자체는 완료 */
  }
}

export function clearMyEntries(mode: "live" | "test"): void {
  try {
    localStorage.removeItem(key(mode));
  } catch {
    /* ignore */
  }
}
