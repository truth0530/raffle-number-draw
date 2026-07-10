// 테스트 샌드박스 엔진 — 유리병(QR) 추첨의 서버 API를 브라우저 로컬에서 그대로 재현한다.
// 목적: 행사 당일 운영(프로덕션 DB)에 전혀 영향 없이, 도우미들이 전체 시나리오
// (QR→응모→마감→추첨→추가추첨→리셋)를 리허설할 수 있게 한다.
//
// 일관성 원칙:
// - 씬 상태머신은 scenes.ts(서버와 동일 모듈)를 그대로 사용
// - 가상 이름 생성은 koreanNames.ts(서버 리허설과 동일 모듈)를 그대로 사용
// - 응답 JSON 형태·에러 코드·상태코드는 실제 API와 동일 → 무대/리모컨/응모 화면을
//   같은 컴포넌트로 공유(전송 계층만 교체)
// - 저장은 localStorage + BroadcastChannel(번호표 모드와 동일 패턴) — 같은 컴퓨터의
//   창들끼리만 동기화되고 외부에서 접근 불가

import { Scene, OPEN_SCENES, REVEAL_SCENES, canTransition, SCENES } from "./scenes";
import { generateUniqueEntrants } from "./koreanNames";

// 기억하기 쉬운 8자리 테스트 진입 코드(민감정보 아님 — 샌드박스는 브라우저 로컬 전용).
export const TEST_CODE = process.env.NEXT_PUBLIC_TEST_CODE || "RAFFLE26";
const AUTH_KEY = "raffle_test_ok";

export function isTestAuthed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTH_KEY) === "1";
}
export function authTest(code: string): boolean {
  const ok = code.trim().toUpperCase() === TEST_CODE.toUpperCase();
  if (ok) localStorage.setItem(AUTH_KEY, "1");
  return ok;
}

type SimEntry = { id: string; name: string; last4: string; ip: string; createdAt: string };
type SimWinner = { entryId: string; rank: number; batch: number };
type SimDB = {
  scene: Scene;
  frozenAt: string | null;
  qrVisible: boolean;
  qrSize: string;
  qrCorner: string;
  corkOpen: boolean;
  shakeAt: string | null;
  drawDuration: number;
  tiltDeg: number;
  entries: SimEntry[];
  winners: SimWinner[];
  collisions: number;
  lastBatch: number;
};

const KEY = "simRaffle:v1";
const CH = "simRaffle";

function defaultDB(): SimDB {
  return {
    scene: "QR",
    frozenAt: null,
    qrVisible: true,
    qrSize: "half",
    qrCorner: "center",
    corkOpen: false,
    shakeAt: null,
    drawDuration: 30,
    tiltDeg: 0,
    entries: [],
    winners: [],
    collisions: 0,
    lastBatch: 0,
  };
}

function load(): SimDB {
  if (typeof window === "undefined") return defaultDB();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDB();
    const d = JSON.parse(raw);
    return { ...defaultDB(), ...d };
  } catch {
    return defaultDB();
  }
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!channel && "BroadcastChannel" in window) channel = new BroadcastChannel(CH);
  return channel;
}

function save(db: SimDB): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* quota — 무시 */
  }
  getChannel()?.postMessage({ t: Date.now() });
}

const rng = (n: number) => Math.floor(Math.random() * n);
const uid = () => `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type Json = Record<string, unknown>;
type Res = { status: number; data: Json };
const ok = (data: Json = {}): Res => ({ status: 200, data: { ok: true, ...data } });
const err = (status: number, error: string, extra: Json = {}): Res => ({
  status,
  data: { ok: false, error, ...extra },
});

// ---- /api/state 와 동일 형태 ----
export async function simGetState(): Promise<Json> {
  const db = load();
  const reveal = REVEAL_SCENES.includes(db.scene);
  const byId = new Map(db.entries.map((e) => [e.id, e]));
  const winners = reveal
    ? db.winners
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((w) => ({
          entryId: w.entryId,
          name: byId.get(w.entryId)?.name ?? "?",
          last4: byId.get(w.entryId)?.last4 ?? "????",
          rank: w.rank,
          batch: w.batch,
        }))
    : [];
  return {
    ok: true,
    scene: db.scene,
    entryCount: db.entries.length,
    rehearsalCount: db.entries.filter((e) => e.ip === "rehearsal").length,
    collisionCount: db.collisions,
    frozenAt: db.frozenAt,
    qr: { visible: db.qrVisible, size: db.qrSize, corner: db.qrCorner },
    cork: db.corkOpen,
    shakeAt: db.shakeAt,
    drawDuration: db.drawDuration,
    tiltDeg: db.tiltDeg,
    winners,
  };
}

// ---- /api/entries 와 동일 형태 ----
export async function simGetEntries(): Promise<Json> {
  const db = load();
  return { ok: true, entries: db.entries.map((e) => ({ id: e.id, name: e.name })) };
}

// ---- 변경 API 라우팅(실제 경로 문자열 그대로) ----
export async function simPost(path: string, body: Json): Promise<Res> {
  const db = load();

  if (path === "/api/enter") {
    const name = String(body.name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
    const last4 = String(body.last4 ?? "").replace(/\D/g, "");
    if (name.length < 1 || name.length > 40) return err(422, "invalid_name");
    if (last4.length !== 4) return err(422, "invalid_last4");
    if (!OPEN_SCENES.includes(db.scene)) return err(409, "closed");
    if (db.entries.some((e) => e.name === name && e.last4 === last4)) {
      db.collisions++;
      save(db);
      return ok({ duplicate: true });
    }
    db.entries.push({ id: uid(), name, last4, ip: "test", createdAt: new Date().toISOString() });
    save(db);
    return ok({ duplicate: false });
  }

  if (path === "/api/scene") {
    const to = String(body.to ?? "") as Scene;
    if (!SCENES.includes(to)) return err(422, "invalid_scene");
    if (db.scene === to) return ok({ scene: to, noop: true });
    if (!canTransition(db.scene, to)) return err(409, "illegal_transition", { from: db.scene, to });
    db.scene = to;
    db.frozenAt = to === "FROZEN" ? new Date().toISOString() : to === "COLLECTING" ? null : db.frozenAt;
    save(db);
    return ok({ scene: to });
  }

  if (path === "/api/draw") {
    const count = Math.floor(Number(body.count));
    if (!Number.isFinite(count) || count < 1 || count > 1000) return err(422, "invalid_count");
    if (!["FROZEN", "DRAWING", "WINNERS"].includes(db.scene)) return err(409, "not_ready", { scene: db.scene });
    const wonIds = new Set(db.winners.map((w) => w.entryId));
    const candidates = db.entries.filter((e) => !wonIds.has(e.id)).map((e) => e.id);
    if (candidates.length === 0) return err(409, "no_candidates");
    const picked = shuffle(candidates).slice(0, count);
    const batch = db.lastBatch + 1;
    const startRank = db.winners.length;
    db.lastBatch = batch;
    picked.forEach((entryId, i) => db.winners.push({ entryId, rank: startRank + i + 1, batch }));
    if (db.scene === "FROZEN") {
      db.scene = "DRAWING";
      db.corkOpen = false;
    }
    const byId = new Map(db.entries.map((e) => [e.id, e]));
    save(db);
    return ok({
      batch,
      requested: count,
      drawn: picked.length,
      shortfall: count - picked.length,
      newWinners: picked.map((id, i) => ({
        name: byId.get(id)?.name,
        last4: byId.get(id)?.last4,
        rank: startRank + i + 1,
      })),
    });
  }

  if (path === "/api/jar") {
    const action = String(body.action ?? "");
    if (action === "openCork") db.corkOpen = true;
    else if (action === "closeCork") db.corkOpen = false;
    else if (action === "shake") db.shakeAt = new Date().toISOString();
    else if (action === "setDuration") {
      const v = Math.max(5, Math.min(180, Math.floor(Number(body.value))));
      if (!Number.isFinite(v)) return err(422, "invalid_value");
      db.drawDuration = v;
    } else if (action === "tilt") {
      const d = Number(body.delta);
      if (!Number.isFinite(d)) return err(422, "invalid_delta");
      db.tiltDeg = Math.max(-60, Math.min(60, db.tiltDeg + d));
    } else if (action === "resetTilt") db.tiltDeg = 0;
    else return err(422, "invalid_action");
    save(db);
    return ok();
  }

  if (path === "/api/display") {
    if (typeof body.visible === "boolean") db.qrVisible = body.visible;
    if (typeof body.size === "string" && ["half", "medium", "small"].includes(body.size)) db.qrSize = body.size;
    if (typeof body.corner === "string" && ["center", "tr"].includes(body.corner)) db.qrCorner = body.corner;
    save(db);
    return ok({ qr: { visible: db.qrVisible, size: db.qrSize, corner: db.qrCorner } });
  }

  if (path === "/api/rehearsal") {
    const action = String(body.action ?? "");
    if (action === "seed") {
      if (!OPEN_SCENES.includes(db.scene)) return err(409, "closed", { scene: db.scene });
      const count = Math.floor(Number(body.count));
      if (!Number.isFinite(count) || count < 1 || count > 500) return err(422, "invalid_count");
      const existing = new Set(db.entries.map((e) => `${e.name}|${e.last4}`));
      const rows = generateUniqueEntrants(count, rng).filter((r) => !existing.has(`${r.name}|${r.last4}`));
      const now = new Date().toISOString();
      for (const r of rows) db.entries.push({ id: uid(), ...r, ip: "rehearsal", createdAt: now });
      save(db);
      return ok({ seeded: rows.length });
    }
    if (action === "clear") {
      if (db.scene === "DRAWING" || db.scene === "WINNERS") return err(423, "live_locked", { scene: db.scene });
      const before = db.entries.length;
      db.entries = db.entries.filter((e) => e.ip !== "rehearsal");
      save(db);
      return ok({ deleted: before - db.entries.length });
    }
    return err(422, "invalid_action");
  }

  if (path === "/api/reset") {
    if (body.confirm !== "RESET") return err(400, "confirm_required");
    const live = db.scene === "DRAWING" || db.scene === "WINNERS";
    if (live && body.force !== true) return err(423, "live_locked", { scene: db.scene });
    const snapshot = {
      at: new Date().toISOString(),
      scene: db.scene,
      entries: db.entries,
      winners: db.winners,
      collisions: db.collisions,
    };
    const cleared = { entries: db.entries.length, winners: db.winners.length };
    save(defaultDB());
    return ok({ snapshot: "(test-local)", snapshotData: snapshot, cleared });
  }

  return err(404, "unknown_path");
}

// 다른 창의 변경 구독(스토리지 이벤트 이중화 — 번호표 모드와 동일 패턴).
export function simSubscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onMsg = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  const ch = getChannel();
  ch?.addEventListener("message", onMsg);
  window.addEventListener("storage", onStorage);
  return () => {
    ch?.removeEventListener("message", onMsg);
    window.removeEventListener("storage", onStorage);
  };
}
