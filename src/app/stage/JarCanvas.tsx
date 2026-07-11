"use client";

import Matter from "matter-js";
import { useEffect, useRef } from "react";
import { colorFor, hash01, BUBBLE_FONT_FAMILY, BUBBLE_NAME_COLOR, bubbleFontSize } from "@/lib/bubbleStyle";

export type Entry = { id: string; name: string };

type Props = {
  scene: string;
  entries: Entry[];
  winnerKeys: Set<string>;
  corkOpen: boolean;
  shakeSeq: number;
  durationMs: number;
  tiltDeg: number;
};

type Ball = {
  id: string;
  name: string;
  body: Matter.Body;
  r: number; // 시각 반지름(부드럽게 애니메이션)
  physR: number; // 물리 반지름(스폰 시 고정, 큰 변화 때만 스냅 재조정)
  winner: boolean;
  // 추가추첨 연출에서 입구 밖으로 흘러내려 탈락할 운명의 버블.
  doomed?: boolean;
  // 배출 단계: phys(물리) → exit(넥 통과 스크립트, 잼 불가능) → fall(병 밖 화면 자유낙하)
  phase: "phys" | "exit" | "fall";
  // via: 몸통 깊은 곳에서 뽑힐 때 목구멍 경유점(로컬) — 직선이 어깨 유리를 지르지 않게.
  exit?: { fromX: number; fromY: number; t0: number; dur: number; viaX?: number; viaY?: number };
  fall?: { x: number; y: number; vx: number; vy: number };
  flashUntil: number;
};

// 추가추첨 붓기 큐: 병을 세운 뒤 주입구 위에서 순차 투하.
type RefillItem = { e: Entry; win: boolean; at: number };

type JarGeom = {
  cx: number;
  cy: number;
  RX: number;
  RY: number;
  mw: number;
  neckLen: number;
};

const GOLD = "#ffd24a";
// 부분 기울기: 완전 180° 금지(생존 버블이 기운 벽에 얹히는 현실감).
// 0.78π(≈140°)면 주둥이가 병의 최저 영역이 되어 중력만으로 흐름이 주둥이로 모인다.
const FLIP = Math.PI * 0.78;
const FLIP_MS = 1400;
const AUTO_TILT_MAX = Math.PI * 0.16;
const AUTO_SHAKE_INTERVAL = 900;
const GRAVITY = 1.15;
const PHYS_DT = 1000 / 120; // 고정 소형 서브스텝(터널링 방지)
const EXIT_MS = 320; // 넥 통과 스크립트 시간
const BALL_CATEGORY = 0x0001;
const WALL_CATEGORY = 0x0002;
const BALL_MASK = BALL_CATEGORY | WALL_CATEGORY;

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// 병 중심 기준 로컬 오프셋(x,y)을 화면 좌표로(병이 angle만큼 회전해 보일 때).
function toScreen(cx: number, cy: number, x: number, y: number, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: cx + x * c - y * s, y: cy + x * s + y * c };
}

export default function JarCanvas({
  scene,
  entries,
  winnerKeys,
  corkOpen,
  shakeSeq,
  durationMs,
  tiltDeg,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const byIdRef = useRef<Map<string, Ball>>(new Map());
  const wallBodiesRef = useRef<Matter.Body[]>([]);
  const corkRef = useRef<Matter.Body | null>(null);
  const pendingRef = useRef<Entry[]>([]);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const baseRRef = useRef<number>(20);
  const drawBaseRRef = useRef<number | null>(null);
  const fixedGeomRef = useRef<JarGeom | null>(null);
  const shakeRef = useRef<number>(shakeSeq);
  const drawStartRef = useRef<number | null>(null);
  const churnedRef = useRef<boolean>(false);
  const autoShakeAtRef = useRef<number>(0);
  const openElapsedRef = useRef<number>(0);
  const losersSnapRef = useRef<number>(0);
  const pluckedRef = useRef<number>(0);
  const lastNowRef = useRef<number>(0);
  const physAccRef = useRef<number>(0);
  const wallKeyRef = useRef<string>("");
  const debugRef = useRef<{ g: JarGeom; angle: number; W: number; H: number } | null>(null);
  // 추가추첨(리필) 연출 상태: 시작되면 병을 세우고 이후 계속 세워둔다.
  const refillQueueRef = useRef<RefillItem[]>([]);
  const refillExpectRef = useRef<Set<string>>(new Set()); // 입구로 들어와야 할 신규 당첨 id
  const refillQueuedRef = useRef<Set<string>>(new Set()); // 큐에 들어있는 id(중복 투하 방지)
  const refillDoomedSeenRef = useRef<Set<string>>(new Set()); // 이미 탈락 연출에 쓴 id
  const refillEaseStartRef = useRef<number | null>(null); // 병 세우기 시작 시각
  const recoveredRef = useRef<number>(0); // 병 밖 이탈 복구 누적(0이어야 정상)
  const rafRef = useRef<number>(0);
  const propsRef = useRef<Props>({ scene, entries, winnerKeys, corkOpen, shakeSeq, durationMs, tiltDeg });
  propsRef.current = { scene, entries, winnerKeys, corkOpen, shakeSeq, durationMs, tiltDeg };

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    const ctx: CanvasRenderingContext2D = c2d;

    // 핵심 아키텍처: 물리 세계에서 병은 "영원히 고정"이다(벽 이동 = 터널링·공중부양의 근원).
    // 기울기(angle)는 (1) 중력 벡터 회전 gravity=(G sinθ, G cosθ) 와 (2) 렌더링 회전으로만 표현한다.
    // 배출은 물리 통과가 아니라 스크립트(pluck)로 보장한다 — 넥 잼이 구조적으로 불가능.
    const engine = Matter.Engine.create({ enableSleeping: false });
    engine.gravity.x = 0;
    engine.gravity.y = GRAVITY;
    engine.positionIterations = 12;
    engine.velocityIterations = 8;
    engineRef.current = engine;

    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      wallKeyRef.current = "";
    }
    resize();
    window.addEventListener("resize", resize);

    function liveGeom(): JarGeom {
      const RY = H * 0.42;
      return {
        cx: W / 2,
        cy: H * 0.5,
        RX: W * 0.44,
        RY,
        mw: Math.max(baseRRef.current * 4.4, W * 0.07),
        neckLen: RY * 0.5,
      };
    }

    function geom(): JarGeom {
      return fixedGeomRef.current ?? liveGeom();
    }

    // 추첨용 기하: 병을 줄이고 위로 올려, 기울었을 때 주둥이와 배출 낙하가 화면 안에 보이게.
    function drawGeom(): JarGeom {
      const RY = H * 0.34;
      return {
        cx: W / 2,
        cy: H * 0.38,
        RX: W * 0.3,
        RY,
        mw: Math.max(baseRRef.current * 4.4, W * 0.06),
        neckLen: RY * 0.5,
      };
    }

    function baseRadius(count: number) {
      const g = liveGeom();
      const r = Math.sqrt((g.RX * g.RY * 0.6) / Math.max(1, count));
      return Math.max(Math.min(W, H) * 0.01, Math.min(Math.min(g.RX, g.RY) * 0.42, r));
    }

    function localOf(g: JarGeom, x: number, y: number) {
      return { x: x - g.cx, y: y - g.cy };
    }

    function insideJar(g: JarGeom, lx: number, ly: number, r: number) {
      const ex = lx / (g.RX + r);
      const ey = ly / (g.RY + r);
      if (ex * ex + ey * ey <= 1.03) return true;
      if (Math.abs(lx) <= g.mw + r * 0.5 && ly >= -g.RY - g.neckLen - r * 2 && ly <= -g.RY * 0.5) return true;
      // 주둥이 위 깔때기 영역(유입 낙하 구간) — 스폰 지점 포함해야 복구 루프가 안 생긴다.
      const lipY = -g.RY - g.neckLen;
      if (ly >= lipY - g.mw * 2.0 && ly < lipY && Math.abs(lx) <= g.mw * 2.5 + r) return true;
      return false;
    }

    // 완전 내부(벽에서 떨어진 자유 공간) 판정 — 복구 투영 목표.
    function strictlyInside(g: JarGeom, lx: number, ly: number, r: number) {
      const ex = lx / Math.max(1, g.RX - r);
      const ey = ly / Math.max(1, g.RY - r);
      if (ex * ex + ey * ey <= 0.96) return true;
      if (Math.abs(lx) <= g.mw - r && ly >= -g.RY - g.neckLen + r && ly <= -g.RY * 0.6) return true;
      return false;
    }

    function inletPoint(g: JarGeom, seed: string) {
      // 3레인 + 높이 스태거로 유입 처리량 확보(한 점 병목 방지).
      const lane = Math.floor(hash01(seed + "lane") * 3) - 1; // -1,0,1
      return {
        x: g.cx + lane * g.mw * 0.55 + (hash01(seed + "x") - 0.5) * g.mw * 0.3,
        y: g.cy - g.RY - g.neckLen - baseRRef.current * (1.6 + hash01(seed + "h") * 1.6),
      };
    }

    function spawn(e: Entry, baseR: number, g: JarGeom, mode: "inlet" | "body" | "refill-win" | "refill-fail") {
      let p: { x: number; y: number };
      let v = { x: (hash01(e.id + "vx") - 0.5) * 0.5, y: 1.6 };
      if (mode === "inlet") {
        p = inletPoint(g, e.id);
      } else if (mode === "refill-win") {
        // 신규 당첨자: 주입구 정중앙 위 — 목을 타고 병 안으로 들어간다.
        p = {
          x: g.cx + (hash01(e.id + "rx") - 0.5) * g.mw * 0.7,
          y: g.cy - g.RY - g.neckLen - baseR * (2.0 + hash01(e.id + "rh") * 2.0),
        };
      } else if (mode === "refill-fail") {
        // 탈락 후보: 주입구를 살짝 빗나가는 위치 — 입구 밖으로 흘러내린다.
        const side = hash01(e.id + "rs") < 0.5 ? -1 : 1;
        p = {
          x: g.cx + side * g.mw * (2.6 + hash01(e.id + "rx") * 1.0),
          y: g.cy - g.RY - g.neckLen - baseR * (2.0 + hash01(e.id + "rh") * 2.5),
        };
        v = { x: side * (0.4 + hash01(e.id + "rv")), y: 1.3 };
      } else {
        p = {
          x: g.cx + (hash01(e.id + "x") - 0.5) * g.RX * 1.2,
          y: g.cy - g.RY * (0.15 + hash01(e.id + "y") * 0.5),
        };
      }
      const body = Matter.Bodies.circle(p.x, p.y, baseR, {
        friction: 0.09,
        frictionStatic: 0.05,
        frictionAir: 0.02,
        restitution: 0.26,
        density: 0.004,
        collisionFilter: { category: BALL_CATEGORY, mask: BALL_MASK },
      });
      Matter.Body.setVelocity(body, v);
      const b: Ball = {
        id: e.id,
        name: e.name,
        body,
        r: baseR * 0.55,
        physR: baseR,
        winner: false,
        doomed: mode === "refill-fail",
        phase: "phys",
        flashUntil: 0,
      };
      byIdRef.current.set(e.id, b);
      ballsRef.current.push(b);
      Matter.Composite.add(engine.world, body);
    }

    function wallOptions(label: string): Matter.IChamferableBodyDefinition {
      return {
        isStatic: true,
        label,
        friction: 0.08,
        frictionStatic: 0.04,
        restitution: 0.08,
        collisionFilter: { category: WALL_CATEGORY, mask: BALL_CATEGORY },
      };
    }

    function addSegment(g: JarGeom, ax: number, ay: number, bx: number, by: number, thickness: number, label: string) {
      const len = Math.hypot(bx - ax, by - ay);
      const body = Matter.Bodies.rectangle(
        g.cx + (ax + bx) / 2,
        g.cy + (ay + by) / 2,
        len,
        thickness,
        wallOptions(label)
      );
      Matter.Body.setAngle(body, Math.atan2(by - ay, bx - ax));
      wallBodiesRef.current.push(body);
    }

    // 벽은 로컬 프레임에 "한 번" 만들고 다시는 움직이지 않는다.
    function buildWalls(g: JarGeom) {
      const key = `${Math.round(W)}:${Math.round(H)}:${Math.round(g.mw)}:${Math.round(g.neckLen)}:${Math.round(baseRRef.current)}`;
      if (key === wallKeyRef.current) return;
      wallKeyRef.current = key;

      Matter.Composite.remove(engine.world, wallBodiesRef.current);
      if (corkRef.current) Matter.Composite.remove(engine.world, corkRef.current);
      wallBodiesRef.current = [];

      // 벽 두께 = 볼 지름 이상(터널링 방지의 물리적 마지노선).
      const thickness = Math.max(18, baseRRef.current * 2.1);
      // 벽 중심을 두께 절반만큼 바깥에 두어, 내부 물리 공간 = 그려진 윤곽선과 일치시킨다.
      // (윤곽 중심에 깔면 remap·투영이 벽 몸체와 겹쳐 밖으로 튕겨나간다 — 실측된 함정)
      const off = thickness / 2;
      const RXw = g.RX + off;
      const RYw = g.RY + off;
      const mwW = g.mw + off;
      const shoulderY = -RYw * 0.15;
      const wShoulder = RXw * Math.sqrt(Math.max(0, 1 - (shoulderY / RYw) ** 2));
      const outline: Array<{ y: number; half: number }> = [];
      for (let i = 0; i <= 28; i++) {
        const y = RYw - (i / 28) * (RYw - shoulderY);
        outline.push({ y, half: RXw * Math.sqrt(Math.max(0, 1 - (y / RYw) ** 2)) });
      }
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        outline.push({ y: shoulderY + (-RYw - shoulderY) * t, half: wShoulder + (mwW - wShoulder) * t });
      }
      outline.push({ y: -g.RY - g.neckLen, half: mwW });

      for (let i = 0; i < outline.length - 1; i++) {
        const a = outline[i];
        const b = outline[i + 1];
        addSegment(g, -a.half, a.y, -b.half, b.y, thickness, "jar-wall");
        addSegment(g, a.half, a.y, b.half, b.y, thickness, "jar-wall");
      }
      addSegment(g, -outline[0].half, outline[0].y, outline[0].half, outline[0].y, thickness, "jar-bottom");
      // 주둥이 위 깔때기 입술: 유입 버블이 옆으로 새지 않게 밖으로 벌어진 가이드.
      const lipY = -g.RY - g.neckLen;
      addSegment(g, -mwW, lipY, -mwW * 2.4, lipY - g.mw * 1.7, thickness, "funnel-lip");
      addSegment(g, mwW, lipY, mwW * 2.4, lipY - g.mw * 1.7, thickness, "funnel-lip");

      // 코르크: 주둥이 끝 마개. DRAWING에서 열기 전까지 전원 차단.
      corkRef.current = Matter.Bodies.rectangle(
        g.cx,
        g.cy - g.RY - g.neckLen - Math.max(9, baseRRef.current * 0.55) - off,
        g.mw * 2.3,
        Math.max(16, baseRRef.current * 1.1),
        {
          isStatic: true,
          label: "cork",
          friction: 0.08,
          restitution: 0.1,
          collisionFilter: { category: WALL_CATEGORY, mask: 0 },
        }
      );

      Matter.Composite.add(engine.world, [...wallBodiesRef.current, corkRef.current]);
    }

    // 탈락자 배출 시작: 물리에서 빼고(더미 자연 붕괴) 넥 통과를 스크립트로.
    // 목구멍 후보만 뽑히므로 경로가 짧아 자연스럽고, 시간은 거리 비례.
    // 몸통 깊은 곳에서 뽑히면(지연 확장·완주 보증) 직선이 어깨 유리를 지르므로
    // 목구멍 경유점을 넣는다 — 타원 몸통은 볼록이라 내부점→경유점 직선은 유리 안에 머문다.
    function startExit(b: Ball, g: JarGeom, now: number) {
      Matter.Composite.remove(engine.world, b.body);
      const fx = b.body.position.x - g.cx;
      const fy = b.body.position.y - g.cy;
      const mouthY = -g.RY - g.neckLen;
      const deep = fy > -g.RY * 0.8; // 어깨 위쪽이 아니면 = 몸통에서 출발
      const viaX = deep ? fx * 0.15 : undefined;
      const viaY = deep ? -g.RY * 0.86 : undefined;
      const dist = deep
        ? Math.hypot(fx - viaX!, fy - viaY!) + Math.hypot(viaX!, viaY! - mouthY)
        : Math.hypot(fx, fy - mouthY);
      b.phase = "exit";
      b.exit = {
        fromX: b.body.position.x,
        fromY: b.body.position.y,
        t0: now,
        dur: Math.min(800, Math.max(200, dist / 0.55)),
        viaX,
        viaY,
      };
      b.flashUntil = now + 260;
    }

    // exit 스크립트의 현재 로컬 좌표(진행 p는 0..1 easing 적용 전 원시값).
    function exitLocalPos(b: Ball, g: JarGeom, now: number): { lx: number; ly: number } {
      const e = b.exit!;
      const p = Math.min(1, (now - e.t0) / e.dur);
      const u = p * p * (3 - 2 * p);
      const fx = e.fromX - g.cx;
      const fy = e.fromY - g.cy;
      const mouthOutX = 0;
      const mouthOutY = -g.RY - g.neckLen - baseRRef.current * 1.6;
      if (e.viaX === undefined || e.viaY === undefined) {
        return { lx: fx + (mouthOutX - fx) * u, ly: fy + (mouthOutY - fy) * u };
      }
      const l1 = Math.hypot(fx - e.viaX, fy - e.viaY);
      const l2 = Math.hypot(e.viaX - mouthOutX, e.viaY - mouthOutY);
      const split = l1 / Math.max(1, l1 + l2);
      if (u <= split) {
        const t = u / Math.max(1e-6, split);
        return { lx: fx + (e.viaX - fx) * t, ly: fy + (e.viaY - fy) * t };
      }
      const t = (u - split) / Math.max(1e-6, 1 - split);
      return { lx: e.viaX + (mouthOutX - e.viaX) * t, ly: e.viaY + (mouthOutY - e.viaY) * t };
    }

    function drawBottle(g: JarGeom, angle: number, corkOpenNow: boolean, celebrate: boolean) {
      const mw = g.mw;
      const neck = g.neckLen;
      const shoulder = g.RX * 0.3;
      ctx.save();
      ctx.translate(g.cx, g.cy);
      ctx.rotate(angle);
      ctx.strokeStyle = "rgba(160,170,210,0.28)";
      ctx.lineWidth = 3;
      const gap = Math.asin(Math.min(0.99, shoulder / g.RX));
      ctx.beginPath();
      ctx.ellipse(0, 0, g.RX, g.RY, 0, -Math.PI / 2 + gap, -Math.PI / 2 - gap + Math.PI * 2);
      ctx.stroke();
      const yShoulder = -g.RY * Math.cos(gap);
      const yTop = -g.RY - neck;
      ctx.beginPath();
      ctx.moveTo(-shoulder, yShoulder);
      ctx.quadraticCurveTo(-mw * 2.6, -g.RY * 0.98, -mw, -g.RY - neck * 0.45);
      ctx.lineTo(-mw, yTop);
      ctx.lineTo(mw, yTop);
      ctx.lineTo(mw, -g.RY - neck * 0.45);
      ctx.quadraticCurveTo(mw * 2.6, -g.RY * 0.98, shoulder, yShoulder);
      ctx.stroke();
      if (propsRef.current.scene === "DRAWING" && !corkOpenNow && !celebrate) {
        ctx.fillStyle = "#a9703c";
        ctx.strokeStyle = "#7a4e22";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-mw * 1.05, yTop - 13, mw * 2.1, 24, 6);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    function step(now: number) {
      const { scene, entries, winnerKeys, corkOpen, shakeSeq, durationMs, tiltDeg } = propsRef.current;
      const balls = ballsRef.current;
      const byId = byIdRef.current;
      const frameDt = lastNowRef.current ? Math.min(50, now - lastNowRef.current) : 16;
      lastNowRef.current = now;

      const drawing = scene === "DRAWING" || scene === "WINNERS";
      if (scene === "QR" || scene === "COLLECTING" || scene === "FROZEN") {
        baseRRef.current = baseRadius(entries.length);
        drawBaseRRef.current = null;
        fixedGeomRef.current = null;
      } else if (drawBaseRRef.current !== null) {
        baseRRef.current = drawBaseRRef.current;
      }
      const baseR = baseRRef.current;
      const g = geom();
      buildWalls(g);

      // 물리 반지름이 시대에 뒤처지면(응모 증가로 baseR 축소) 한 번에 스냅 재조정.
      // 수집 국면 전용 — DRAWING/WINNERS에선 당첨 확대 성장 블록이 크기를 관리한다(충돌 실측).
      if (!drawing) {
        for (const b of balls) {
          if (b.phase !== "phys") continue;
          if (Math.abs(b.physR - baseR) / baseR > 0.15) {
            const ratio = baseR / b.physR;
            Matter.Body.scale(b.body, ratio, ratio);
            b.physR = baseR;
          }
        }
      }

      // 유입: 스폰 지점이 비어 있을 때만(백프레셔) — 겹침 폭발로 밖에 넘치는 것 원천 차단.
      if (scene === "QR" || scene === "COLLECTING") {
        for (const e of entries) {
          if (!byId.has(e.id) && !pendingIdsRef.current.has(e.id)) {
            pendingIdsRef.current.add(e.id);
            pendingRef.current.push(e);
          }
        }
        let budget = 10;
        let scan = 0;
        while (budget > 0 && scan < pendingRef.current.length) {
          const e = pendingRef.current[scan];
          const p = inletPoint(g, e.id);
          let clear = true;
          for (const b of balls) {
            if (b.phase !== "phys") continue;
            const dx = b.body.position.x - p.x;
            const dy = b.body.position.y - p.y;
            if (dx * dx + dy * dy < (baseR * 2.1) ** 2) {
              clear = false;
              break;
            }
          }
          if (!clear) {
            scan++;
            continue;
          }
          pendingRef.current.splice(scan, 1);
          pendingIdsRef.current.delete(e.id);
          if (!byId.has(e.id)) spawn(e, baseR, g, "inlet");
          budget--;
        }
      }

      // 마감 후(FROZEN) 새로고침 복원: 유입은 QR/COLLECTING에서만 일어나므로,
      // 무대를 늦게 열거나 새로고침하면 병이 텅 빈다 — 미등록 버블을 몸통에 직접 복원.
      if (scene === "FROZEN") {
        let budget = 40; // 프레임당 분할 스폰(한 번에 전부 넣으면 겹침 폭발)
        for (const e of entries) {
          if (budget <= 0) break;
          if (!byId.has(e.id)) {
            spawn(e, baseR, g, "body");
            budget--;
          }
        }
      }

      if (scene === "DRAWING" && drawStartRef.current === null) {
        // 새로고침 복원이면 baseR가 기본값(20)인 채라, 인원수 기준으로 먼저 재계산해야 한다.
        // 안 하면 300명×r20이 추첨 기하에 물리적으로 안 들어가 압착·압출 폭주(실측 recovered 3만).
        baseRRef.current = baseRadius(entries.length);
        // 대기분 + 미등록분 전부 즉시 투입(DRAWING 중 새로고침 복원 포함).
        pendingRef.current = [];
        pendingIdsRef.current.clear();
        for (const e of entries) {
          if (!byId.has(e.id)) spawn(e, baseRRef.current, liveGeom(), "body");
        }
        drawBaseRRef.current = baseRRef.current;
        // 수집 기하 → 추첨 기하로 병을 재배치하고, 버블 좌표를 비율 매핑(1회성).
        const gOld = liveGeom();
        const gNew = drawGeom();
        fixedGeomRef.current = gNew;
        wallKeyRef.current = "";
        for (const b of balls) {
          if (b.phase !== "phys") continue;
          const lx = (b.body.position.x - gOld.cx) * (gNew.RX / gOld.RX);
          const ly = (b.body.position.y - gOld.cy) * (gNew.RY / gOld.RY);
          // 여유 0.85: 벽 몸체와의 겹침 배치 금지(겹치면 바깥으로 튕겨난다).
          Matter.Body.setPosition(b.body, { x: gNew.cx + lx * 0.85, y: gNew.cy + ly * 0.85 });
          Matter.Body.setVelocity(b.body, { x: 0, y: 0 });
        }
        drawStartRef.current = now;
        churnedRef.current = false;
        autoShakeAtRef.current = now;
        openElapsedRef.current = 0;
        pluckedRef.current = 0;
        losersSnapRef.current = 0;
      }
      if (!drawing) {
        drawStartRef.current = null;
        churnedRef.current = false;
        autoShakeAtRef.current = 0;
        openElapsedRef.current = 0;
        pluckedRef.current = 0;
        losersSnapRef.current = 0;
      }

      // ---- 추가추첨(리필) 연출 ----
      // 새 당첨자가 생겼는데 그 버블이 화면에 없으면(이미 배출됨): 병을 세우고,
      // 주입구 위에서 후보(신규 당첨자 + 탈락 조연)를 쏟는다. 당첨자만 입구로 들어가고
      // 나머지는 입구 밖으로 흘러내려 탈락하는 구조.
      if (scene === "DRAWING" && drawStartRef.current !== null) {
        const missing: Entry[] = [];
        for (const e of entries) {
          if (winnerKeys.has(e.id) && !byId.has(e.id) && !refillQueuedRef.current.has(e.id)) missing.push(e);
        }
        if (missing.length > 0) {
          if (refillEaseStartRef.current === null) refillEaseStartRef.current = now;
          const pool = entries.filter(
            (e) =>
              !winnerKeys.has(e.id) &&
              !byId.has(e.id) &&
              !refillQueuedRef.current.has(e.id) &&
              !refillDoomedSeenRef.current.has(e.id)
          );
          // 탈락 조연: 당첨자 수의 2배쯤 섞어 부어야 "일부만 들어가는" 그림이 된다.
          const doomedCount = Math.min(pool.length, Math.max(4, missing.length * 2));
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(hash01(pool[i].id + now) * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          const doomed = pool.slice(0, doomedCount);
          doomed.forEach((e) => refillDoomedSeenRef.current.add(e.id));
          const mix: { e: Entry; win: boolean }[] = [
            ...missing.map((e) => ({ e, win: true })),
            ...doomed.map((e) => ({ e, win: false })),
          ];
          for (let i = mix.length - 1; i > 0; i--) {
            const j = Math.floor(hash01(mix[i].e.id + "mix") * (i + 1));
            [mix[i], mix[j]] = [mix[j], mix[i]];
          }
          // 병이 세워질 시간(1.4s)을 준 뒤 240ms 간격으로 붓는다.
          const lastAt = refillQueueRef.current.length
            ? refillQueueRef.current[refillQueueRef.current.length - 1].at
            : now + 1500;
          mix.forEach((m, i) => {
            refillQueueRef.current.push({ ...m, at: lastAt + i * 240 });
            refillQueuedRef.current.add(m.e.id);
            if (m.win) refillExpectRef.current.add(m.e.id);
          });
        }
        // 큐 소진: 시간이 된 것부터 투하.
        while (refillQueueRef.current.length && refillQueueRef.current[0].at <= now) {
          const item = refillQueueRef.current.shift()!;
          refillQueuedRef.current.delete(item.e.id);
          if (!byId.has(item.e.id)) spawn(item.e, baseR, g, item.win ? "refill-win" : "refill-fail");
        }
      }
      const refillStarted = refillEaseStartRef.current !== null;
      const refillActive =
        refillStarted &&
        (refillQueueRef.current.length > 0 ||
          balls.some((b) => b.phase === "phys" && b.doomed) ||
          [...refillExpectRef.current].some((id) => !byId.has(id)));

      const fe = drawStartRef.current === null ? 0 : (now - drawStartRef.current) / FLIP_MS;
      const openFrac = openElapsedRef.current / Math.max(1000, durationMs);
      const autoTilt =
        drawing && corkOpen && winnerKeys.size > 0
          ? AUTO_TILT_MAX * Math.min(1, Math.max(0, openFrac - 0.45) / 0.55)
          : 0;
      let angle = drawing
        ? FLIP * easeInOut(Math.min(1, Math.max(0, fe))) + autoTilt + (tiltDeg * Math.PI) / 180
        : 0;
      // 리필이 시작되면 병을 부드럽게 세우고(1.4s), 이후 계속 세워둔다(수동 기울기만 유지).
      if (refillStarted) {
        const k = easeInOut(Math.min(1, (now - (refillEaseStartRef.current ?? now)) / 1400));
        angle = angle * (1 - k) + ((tiltDeg * Math.PI) / 180) * k;
      }

      // 기울기 = 중력 회전. 병은 물리적으로 고정.
      engine.gravity.x = GRAVITY * Math.sin(angle);
      engine.gravity.y = GRAVITY * Math.cos(angle);

      let physLosers = 0;
      let exiting = 0;
      for (const b of balls) {
        b.winner = winnerKeys.has(b.id);
        if (b.phase === "phys" && !b.winner) physLosers++;
        if (b.phase === "exit") exiting++;
      }
      const celebrate =
        drawing && winnerKeys.size > 0 && physLosers === 0 && exiting === 0 && !refillActive;
      // 리필이 시작되면 배출은 끝났다 — 다시 뽑지 않는다.
      const holeOpen = drawing && winnerKeys.size > 0 && corkOpen && !celebrate && !refillStarted;

      // 코르크는 DRAWING 내내 물리 마개로 유지한다(시각적으로만 열림).
      // 배출은 전부 스크립트(pluck)이므로 물리적 통과가 필요 없고, 이로써
      // 당첨자가 열린 주둥이로 미끄러져 나가는 탈출·복구 루프가 원천 봉쇄된다.
      // 리필 중에는 마개를 비활성화해 신규 당첨자가 목을 타고 들어온다(병이 세워져 있어 탈출 없음).
      if (corkRef.current)
        corkRef.current.collisionFilter.mask = drawing && !refillStarted ? BALL_CATEGORY : 0;

      // 당첨 버블은 색을 바꾸지 않고 "물리 몸체 자체"를 키운다 — 시각만 키우면
      // 서로 겹쳐 이름 가독성이 무너진다(실측). 몸체가 커지면 서로 밀어내 안 겹친다.
      for (const b of balls) {
        if (b.phase === "phys" && drawing) {
          const winnerBig = b.winner && (celebrate || refillStarted);
          const tR = winnerBig ? baseR * 1.42 : baseR;
          const ratio = tR / b.physR;
          if (Math.abs(ratio - 1) > 0.012) {
            const k = Math.max(0.985, Math.min(1.015, ratio));
            Matter.Body.scale(b.body, k, k);
            b.physR *= k;
          }
        }
        b.r += (b.physR - b.r) * 0.12;
      }

      // 당첨자는 넥에 들어가지 않게 몸통 쪽으로 밀어낸다(생존자가 기운 벽에 얹히는 연출 + 넥 막힘 방지).
      // 기울기 극대(164°)의 중력(-0.94G)보다 강해야 실제로 밀려난다.
      // 리필 중에는 금지 — 신규 당첨자가 넥을 "통과해 들어와야" 한다.
      if (drawing && winnerKeys.size > 0 && !refillStarted) {
        for (const b of balls) {
          if (b.phase !== "phys" || !b.winner) continue;
          const lx = b.body.position.x - g.cx;
          const ly = b.body.position.y - g.cy;
          // 넥 통로 안에서만 밀어낸다 — 어깨 전체를 밀면 당첨자 무리가
          // 목구멍 앞 장벽이 되어 탈락자 공급을 막는다(꼬리 정체 실측).
          if (ly < -g.RY * 0.5 && Math.abs(lx) < g.mw * 2.2) {
            Matter.Body.applyForce(b.body, b.body.position, { x: 0, y: b.body.mass * 0.008 });
          }
        }
      }

      if (drawing && fe > 0.4 && !churnedRef.current) {
        churnedRef.current = true;
        for (const b of balls) {
          if (b.phase !== "phys") continue;
          Matter.Body.setVelocity(b.body, {
            x: b.body.velocity.x + (hash01(b.id + "cx") - 0.5) * 3.5,
            y: b.body.velocity.y + (hash01(b.id + "cy") - 0.5) * 3.5,
          });
        }
      }

      if (shakeSeq !== shakeRef.current) {
        shakeRef.current = shakeSeq;
        // 흔들기 = 중력 반대 방향 "토스". 무작위 속도(±)는 중력에 눌린 더미에선
        // 티가 안 난다(실측) — 현재 기울기 기준 위로 던져 눈에 보이게 점프시킨다.
        const gx = engine.gravity.x;
        const gy = engine.gravity.y;
        const gl = Math.hypot(gx, gy) || 1;
        const ux = -gx / gl;
        const uy = -gy / gl;
        for (const b of balls) {
          if (b.phase !== "phys") continue;
          const kUp = 8 + hash01(b.id + shakeSeq + "sk") * 5;
          const kLat = (hash01(b.id + shakeSeq + "sl") - 0.5) * 7;
          Matter.Body.setVelocity(b.body, {
            x: b.body.velocity.x + ux * kUp + -uy * kLat,
            y: b.body.velocity.y + uy * kUp + ux * kLat,
          });
        }
      }

      let suctionMouth: { x: number; y: number } | null = null;
      if (holeOpen) {
        if (losersSnapRef.current === 0) losersSnapRef.current = physLosers;
        openElapsedRef.current += frameDt;
        const frac = Math.min(1, openElapsedRef.current / Math.max(1000, durationMs));
        const scheduleFrac = Math.min(1, frac * 1.18);
        const targetGone = Math.floor(losersSnapRef.current * scheduleFrac);
        const mouthX = g.cx;
        const mouthY = g.cy - g.RY - g.neckLen;
        suctionMouth = { x: mouthX, y: mouthY };
        // 탈락은 "주둥이 목구멍에 실제로 도달한" 버블만 — 깊숙한 버블을 총알처럼
        // 뽑아내면 앞의 버블을 유령처럼 통과해 먼저 나가는 그림이 된다(실측 지적).
        // 기본 구역을 목구멍 코앞으로 좁히고, 공급은 흡입류가 담당한다.
        const lag = Math.max(0, targetGone - pluckedRef.current);
        const rawFrac = openElapsedRef.current / Math.max(1000, durationMs);
        // 지연(lag) 또는 시간 초과 시 구역을 확장 — 초과가 커지면 병 전체를 허용해 완주를 보장.
        const relax = Math.max(
          Math.min(1, lag / Math.max(6, losersSnapRef.current * 0.08)),
          Math.min(1, Math.max(0, rawFrac - 0.9) * 3)
        );
        const overdue = rawFrac > 1.6; // 완주 보증 모드: 병 전체 허용
        const zoneY = overdue ? g.RY * 2 : -g.RY * (0.8 - 0.6 * relax);
        const zoneX = overdue ? g.RX * 2 : g.mw * (1.7 + 2.6 * relax);
        // 동시 배출 상한: 여러 개가 한꺼번에 스크립트되면 깊은 버블이 앞 버블을
        // 추월·관통하는 착시의 근원 — 목구멍 앞 소수만 순차 배출한다.
        const CAP = overdue ? 9 : 5;
        let exitingNow = exiting;
        while (pluckedRef.current < targetGone && exitingNow < CAP) {
          let best: Ball | null = null;
          let bestD = Infinity;
          for (const b of balls) {
            if (b.phase !== "phys" || b.winner || b.doomed) continue;
            const lx = b.body.position.x - g.cx;
            const ly = b.body.position.y - g.cy;
            if (ly > zoneY || Math.abs(lx) > zoneX) continue; // 목구멍 밖 = 아직 순서 아님
            const d = (b.body.position.x - mouthX) ** 2 + (b.body.position.y - mouthY) ** 2;
            if (d < bestD) {
              bestD = d;
              best = b;
            }
          }
          if (!best) break; // 후보 없음 — 흡입류가 공급할 때까지 대기
          startExit(best, g, now);
          pluckedRef.current++;
          exitingNow++;
        }
        // 보조 슬로싱: 정체가 클 때만 가끔 킥(주 공급은 흡입류).
        const feedInterval = lag > 0 ? 600 : AUTO_SHAKE_INTERVAL;
        if (physLosers > 0 && now - autoShakeAtRef.current > feedInterval) {
          autoShakeAtRef.current = now;
          for (const b of balls) {
            if (b.phase !== "phys" || b.winner || b.doomed) continue;
            const dx = mouthX - b.body.position.x;
            const dy = mouthY - b.body.position.y;
            const len = Math.max(1, Math.hypot(dx, dy));
            const k = 0.9 + hash01(b.id + Math.floor(now) + "f") * 1.2;
            Matter.Body.setVelocity(b.body, {
              x: b.body.velocity.x + (dx / len) * k,
              y: b.body.velocity.y + (dy / len) * k,
            });
          }
        }
      }

      // 고정 소형 dt 서브스텝 + 속도 상한(볼이 한 스텝에 벽 두께 이상 이동 금지).
      const maxV = Math.min(26, baseR * 1.7);
      physAccRef.current = Math.min(physAccRef.current + frameDt, PHYS_DT * 4);
      while (physAccRef.current >= PHYS_DT) {
        physAccRef.current -= PHYS_DT;
        for (const b of balls) {
          if (b.phase !== "phys") continue;
          // 흡입류: 코르크가 열려 있는 동안 탈락자를 주둥이 쪽으로 끄는 연속 미세 힘.
          // 간헐 킥보다 강물처럼 자연스럽고, 목구멍 공급이 끊기지 않는다.
          if (suctionMouth && !b.winner && !b.doomed) {
            const dx = suctionMouth.x - b.body.position.x;
            const dy = suctionMouth.y - b.body.position.y;
            const len = Math.max(1, Math.hypot(dx, dy));
            const F = b.body.mass * 0.0026;
            Matter.Body.applyForce(b.body, b.body.position, { x: (dx / len) * F, y: (dy / len) * F });
          }
          const v = b.body.velocity;
          const sp = Math.hypot(v.x, v.y);
          if (sp > maxV) {
            Matter.Body.setVelocity(b.body, { x: (v.x / sp) * maxV, y: (v.y / sp) * maxV });
          }
        }
        Matter.Engine.update(engine, PHYS_DT);
      }

      // exit 스크립트 진행: 현 위치 → (경유점) → 주둥이 바깥(로컬), 끝나면 화면 자유낙하로 전환.
      for (const b of balls) {
        if (b.phase === "exit" && b.exit) {
          const p = Math.min(1, (now - b.exit.t0) / b.exit.dur);
          if (p >= 1) {
            const lp = exitLocalPos(b, g, now);
            const ps = toScreen(g.cx, g.cy, lp.lx, lp.ly, angle);
            // 넥 축 방향(로컬 -y)의 화면 방향으로 초기 속도.
            const dir = toScreen(0, 0, 0, -1, angle);
            b.phase = "fall";
            b.fall = { x: ps.x, y: ps.y, vx: dir.x * 3.2, vy: dir.y * 3.2 };
            b.exit = undefined;
          }
        }
        if (b.phase === "fall" && b.fall) {
          b.fall.vy += 0.0011 * frameDt * frameDt * 0.5 + 0.28 * (frameDt / 16.7);
          b.fall.x += b.fall.vx * (frameDt / 16.7);
          b.fall.y += b.fall.vy * (frameDt / 16.7);
        }
      }

      // 이탈 복구(물리 볼 전원): 어떤 이유로든 병 밖 = 즉시 안으로. "병 밖 버블 0" 불변식.
      // 순간이동 티가 안 나게, 중심 방향으로 최소한만 끌어당겨 안으로 재투영한다.
      // 예외: 리필 탈락 후보(doomed)는 병 밖으로 흘러내리는 것이 정상 — 화면 자유낙하로 전환.
      for (const b of balls) {
        if (b.phase !== "phys") continue;
        const lp = localOf(g, b.body.position.x, b.body.position.y);
        if (!insideJar(g, lp.x, lp.y, b.physR)) {
          if (b.doomed) {
            const ps = toScreen(g.cx, g.cy, lp.x, lp.y, angle);
            Matter.Composite.remove(engine.world, b.body);
            b.phase = "fall";
            b.fall = {
              x: ps.x,
              y: ps.y,
              vx: b.body.velocity.x,
              vy: Math.max(0.6, b.body.velocity.y),
            };
            continue;
          }
          if (scene === "QR" || scene === "COLLECTING") {
            const p = inletPoint(g, b.id + String(Math.floor(now / 500)));
            Matter.Body.setPosition(b.body, p);
            Matter.Body.setVelocity(b.body, { x: 0, y: 1.4 });
          } else {
            let lx = lp.x;
            let ly = lp.y;
            let ok = false;
            for (let k = 0; k < 24; k++) {
              lx *= 0.92;
              ly *= 0.92;
              if (strictlyInside(g, lx, ly, b.physR)) {
                ok = true;
                break;
              }
            }
            if (!ok) {
              lx = (hash01(b.id + "fx") - 0.5) * g.RX * 0.5;
              ly = (hash01(b.id + "fy") - 0.5) * g.RY * 0.4;
            }
            Matter.Body.setPosition(b.body, { x: g.cx + lx, y: g.cy + ly });
            Matter.Body.setVelocity(b.body, { x: 0, y: 0 });
          }
          Matter.Body.setAngularVelocity(b.body, 0);
          recoveredRef.current++;
        }
      }

      // 낙하 버블은 화면 밖으로 나가면 제거.
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.phase !== "fall" || !b.fall) continue;
        if (b.fall.y - b.r > H + 80 || b.fall.x < -160 || b.fall.x > W + 160) {
          byId.delete(b.id);
          balls.splice(i, 1);
        }
      }

      // 자동 검증용 계측(무해한 읽기 전용 메트릭).
      debugRef.current = { g, angle, W, H };
      (window as unknown as Record<string, unknown>).__jar = {
        scene,
        n: balls.length,
        physLosers,
        exiting,
        winners: balls.filter((b) => b.winner).length,
        plucked: pluckedRef.current,
        recovered: recoveredRef.current,
        pending: pendingRef.current.length,
        angleDeg: Math.round((angle * 180) / Math.PI),
        openMs: Math.round(openElapsedRef.current),
        celebrate,
        refillActive,
        refillQueue: refillQueueRef.current.length,
        doomed: balls.filter((b) => b.doomed && b.phase === "phys").length,
      };

      ctx.clearRect(0, 0, W, H);
      drawBottle(g, angle, corkOpen, celebrate);

      // 물리 버블 먼저, 배출(exit/fall) 버블은 마지막에 — 항상 맨 위 레이어로
      // 그려서 "다른 버블 뒤로 통과하는" 착시를 없앤다.
      const renderOrder = [
        ...balls.filter((b) => b.phase === "phys"),
        ...balls.filter((b) => b.phase !== "phys"),
      ];
      for (const b of renderOrder) {
        let px: number;
        let py: number;
        if (b.phase === "fall" && b.fall) {
          px = b.fall.x;
          py = b.fall.y;
        } else if (b.phase === "exit" && b.exit) {
          const lp = exitLocalPos(b, g, now);
          const ps = toScreen(g.cx, g.cy, lp.lx, lp.ly, angle);
          px = ps.x;
          py = ps.y;
        } else {
          const ps = toScreen(g.cx, g.cy, b.body.position.x - g.cx, b.body.position.y - g.cy, angle);
          px = ps.x;
          py = ps.y;
        }
        const flashing = now < b.flashUntil;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(px, py, b.r, 0, Math.PI * 2);
        // 당첨 버블도 색은 그대로(확대만) — 색이 바뀌면 이름 대비가 무너진다(실측 지적).
        ctx.fillStyle = colorFor(b.id);
        if (flashing) {
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 24;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        // 확대된 당첨 버블은 금테 링으로만 표시(내부 색·이름 대비 유지).
        if (celebrate && b.winner) {
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = Math.max(2, b.r * 0.08);
          ctx.stroke();
        }

        // 이름은 항상 표기: 버블 지름에 여백 최소로 우겨넣는다(초대형 스크린 전제).
        const fs = bubbleFontSize(b.r, b.name);
        ctx.fillStyle = BUBBLE_NAME_COLOR;
        ctx.font = `700 ${fs.toFixed(1)}px ${BUBBLE_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(b.name, px, py);
      }

      rafRef.current = requestAnimationFrame(step);
    }

    // 물리 검증용 상세 스냅샷(호출 시에만 생성 — 프레임 비용 없음).
    (window as unknown as Record<string, unknown>).__jarInspect = () => {
      const d = debugRef.current;
      if (!d) return null;
      return {
        ...d,
        balls: ballsRef.current.map((b) => ({
          id: b.id,
          phase: b.phase,
          winner: b.winner,
          x: b.body.position.x,
          y: b.body.position.y,
          vx: b.body.velocity.x,
          vy: b.body.velocity.y,
          r: b.r,
          physR: b.physR,
          exit: b.exit
            ? { fromX: b.exit.fromX, fromY: b.exit.fromY, t0: b.exit.t0, dur: b.exit.dur, viaX: b.exit.viaX, viaY: b.exit.viaY }
            : null,
          fall: b.fall ? { x: b.fall.x, y: b.fall.y } : null,
        })),
      };
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      Matter.Composite.clear(engine.world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (scene !== "QR") return;
    const engine = engineRef.current;
    if (engine) {
      for (const b of ballsRef.current) {
        if (b.phase === "phys") Matter.Composite.remove(engine.world, b.body);
      }
    }
    ballsRef.current = [];
    byIdRef.current.clear();
    pendingRef.current = [];
    pendingIdsRef.current.clear();
    drawBaseRRef.current = null;
    fixedGeomRef.current = null;
    wallKeyRef.current = "";
    drawStartRef.current = null;
    openElapsedRef.current = 0;
    pluckedRef.current = 0;
    losersSnapRef.current = 0;
    autoShakeAtRef.current = 0;
    churnedRef.current = false;
    refillQueueRef.current = [];
    refillExpectRef.current.clear();
    refillQueuedRef.current.clear();
    refillDoomedSeenRef.current.clear();
    refillEaseStartRef.current = null;
  }, [scene]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh" }}
    />
  );
}
