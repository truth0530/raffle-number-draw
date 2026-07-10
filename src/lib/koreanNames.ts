// 가상 응모자 이름 생성 — 서버 리허설(/api/rehearsal)과 테스트 샌드박스가 공유.
// rng: 0 <= rng(n) < n 정수를 반환하는 함수(서버는 crypto.randomInt, 브라우저는 Math.random 기반).

const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구".split("");
const GIVEN1 = "민서예지도하주은서지현우준유윤채소수진영".split("");
const GIVEN2 = "준호연우진아윤서은빈율호정민석희찬결담".split("");

export function randomName(rng: (n: number) => number): string {
  return SURNAMES[rng(SURNAMES.length)] + GIVEN1[rng(GIVEN1.length)] + GIVEN2[rng(GIVEN2.length)];
}

export function randomLast4(rng: (n: number) => number): string {
  return String(rng(10000)).padStart(4, "0");
}

// (name,last4) 유니크 제약과 충돌하지 않게 메모리에서 중복 제거하며 count개 생성.
export function generateUniqueEntrants(
  count: number,
  rng: (n: number) => number
): { name: string; last4: string }[] {
  const seen = new Set<string>();
  const rows: { name: string; last4: string }[] = [];
  let guard = 0;
  while (rows.length < count && guard < count * 20) {
    guard++;
    const name = randomName(rng);
    const last4 = randomLast4(rng);
    const key = `${name}|${last4}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, last4 });
  }
  return rows;
}
