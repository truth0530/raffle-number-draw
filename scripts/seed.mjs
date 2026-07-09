// 가짜 응모자 시드 (S2 시각효과 테스트용). 서버 없이 DB에 직접 삽입.
// 사용: node scripts/seed.mjs [count]   (기본 400)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노정하곽성차주우구".split("");
const GIVEN1 = "민서예지도하주은서지현우준유윤채소하지수현진영".split("");
const GIVEN2 = "준호연우진아윤서은빈아율호정민석희찬율담결".split("");

function randName() {
  const s = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  const g1 = GIVEN1[Math.floor(Math.random() * GIVEN1.length)];
  const g2 = GIVEN2[Math.floor(Math.random() * GIVEN2.length)];
  return s + g1 + g2;
}
function randLast4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

async function main() {
  const count = parseInt(process.argv[2] ?? "400", 10);
  const seen = new Set();
  let inserted = 0;
  let attempts = 0;

  while (inserted < count && attempts < count * 5) {
    attempts++;
    const name = randName();
    const last4 = randLast4();
    const key = `${name}|${last4}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await prisma.entry.create({ data: { name, last4, ip: "seed" } });
      inserted++;
    } catch {
      /* unique 충돌 무시 */
    }
  }

  const total = await prisma.entry.count();
  console.log(`seeded ${inserted} entries (total in DB: ${total})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
