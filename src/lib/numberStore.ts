// 현장 번호 추첨 — 서버/DB 없이 같은 브라우저의 두 창(발표자 admin + 슬라이드쇼 popup)을
// localStorage + BroadcastChannel 로 동기화한다. Vercel(서버리스)에서도 완벽 동작하며,
// 브라우저별로 상태가 격리되어 외부에서 조작 불가.

export type Status = "pending" | "received" | "absent";
export type NumItem = { n: number; added: boolean; status: Status };
export type NState = {
  rangeMax: number;
  drawCount: number;
  revealMs: number;
  drawing: boolean;
  numbers: NumItem[];
  removed: number[];
};

export const defaultState: NState = {
  rangeMax: 400,
  drawCount: 20,
  revealMs: 1000,
  drawing: false,
  numbers: [],
  removed: [],
};

const KEY = "numberDraw:v1";
const CH = "numberDraw";

export function loadState(): NState {
  if (typeof window === "undefined") return { ...defaultState };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultState };
    const s = JSON.parse(raw);
    return {
      rangeMax: Number(s.rangeMax) || 400,
      drawCount: Number(s.drawCount) || 20,
      revealMs: Number(s.revealMs) || 1000,
      drawing: !!s.drawing,
      numbers: Array.isArray(s.numbers)
        ? s.numbers.map((x: { n: number; added?: boolean; status?: string }) => ({
            n: x.n,
            added: !!x.added,
            status: (x.status === "received" || x.status === "absent" ? x.status : "pending") as Status,
          }))
        : [],
      removed: Array.isArray(s.removed) ? s.removed : [],
    };
  } catch {
    return { ...defaultState };
  }
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!channel && "BroadcastChannel" in window) channel = new BroadcastChannel(CH);
  return channel;
}

export function saveState(s: NState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
  getChannel()?.postMessage({ t: Date.now() });
}

// 다른 창의 변경을 구독(BroadcastChannel + storage 이벤트 이중화).
export function subscribe(cb: (s: NState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onMsg = () => cb(loadState());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb(loadState());
  };
  const ch = getChannel();
  ch?.addEventListener("message", onMsg);
  window.addEventListener("storage", onStorage);
  return () => {
    ch?.removeEventListener("message", onMsg);
    window.removeEventListener("storage", onStorage);
  };
}

// ---- 순수 로직 ----
export function pickRandom(max: number, count: number, exclude: Set<number>): number[] {
  const pool: number[] = [];
  for (let i = 1; i <= max; i++) if (!exclude.has(i)) pool.push(i);
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take).sort((a, b) => a - b);
}

export function actConfig(s: NState, patch: Partial<Pick<NState, "rangeMax" | "drawCount" | "revealMs">>): NState {
  return { ...s, ...patch };
}
export function actDraw(s: NState): NState {
  // 순차 추첨 시작(번호는 actReveal 로 1개씩 실시간 결정 — 미리 정하지 않음).
  return { ...s, numbers: [], removed: [], drawing: true };
}
export function actReveal(s: NState): NState {
  if (!s.drawing) return s;
  const numbers = [...s.numbers];
  if (numbers.length < s.drawCount) {
    const exclude = new Set<number>([...numbers.map((it) => it.n), ...s.removed]);
    const picked = pickRandom(s.rangeMax, 1, exclude);
    if (picked.length) numbers.push({ n: picked[0], added: false, status: "pending" });
  }
  const drawing = numbers.length < s.drawCount;
  return { ...s, numbers, drawing };
}
export function actMark(s: NState, n: number, status: Status): NState {
  const numbers = s.numbers.map((it) =>
    it.n === n ? { ...it, status: it.status === status ? ("pending" as Status) : status, added: false } : it
  );
  return { ...s, numbers };
}
export function actFill(s: NState): NState {
  const absent = s.numbers.filter((it) => it.status === "absent").map((it) => it.n);
  const removed = [...s.removed];
  for (const n of absent) if (!removed.includes(n)) removed.push(n);
  let numbers = s.numbers.filter((it) => it.status !== "absent").map((it) => ({ ...it, added: false }));
  const need = s.drawCount - numbers.length;
  if (need > 0) {
    const exclude = new Set<number>([...numbers.map((it) => it.n), ...removed]);
    const picked = pickRandom(s.rangeMax, need, exclude);
    numbers = [...numbers, ...picked.map((n) => ({ n, added: true, status: "pending" as Status }))];
  }
  return { ...s, numbers, removed };
}
export function actReset(s: NState): NState {
  return { ...s, numbers: [], removed: [], drawing: false };
}
