"use client";

import Matter from "matter-js";
import { useEffect, useRef } from "react";

export type Entry = { id: string; name: string; last4: string };

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
  key: string;
  body: Matter.Body;
  r: number;
  targetR: number;
  winner: boolean;
  targeted: boolean;
  flashUntil: number;
};

type JarGeom = {
  cx: number;
  cy: number;
  RX: number;
  RY: number;
  mw: number;
  neckLen: number;
};

type Segment = {
  body: Matter.Body;
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

const COLORS = ["#6d5cff", "#4f8cff", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb923c"];
const GOLD = "#ffd24a";
const FLIP = Math.PI * 0.62;
const FLIP_MS = 1600;
const AUTO_TILT_MAX = Math.PI * 0.18;
const AUTO_SHAKE_INTERVAL = 900;
const BALL_CATEGORY = 0x0001;
const WALL_CATEGORY = 0x0002;
const GATE_CATEGORY = 0x0004;
const BALL_MASK = BALL_CATEGORY | WALL_CATEGORY | GATE_CATEGORY;
const TARGETED_MASK = BALL_CATEGORY | WALL_CATEGORY;

function hash01(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function rotatePoint(cx: number, cy: number, x: number, y: number, angle: number) {
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
  const wallsRef = useRef<Segment[]>([]);
  const gateRef = useRef<Matter.Body | null>(null);
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
  const targetedCountRef = useRef<number>(0);
  const lastNowRef = useRef<number>(0);
  const wallKeyRef = useRef<string>("");
  const rafRef = useRef<number>(0);
  const propsRef = useRef<Props>({ scene, entries, winnerKeys, corkOpen, shakeSeq, durationMs, tiltDeg });
  propsRef.current = { scene, entries, winnerKeys, corkOpen, shakeSeq, durationMs, tiltDeg };

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    const ctx: CanvasRenderingContext2D = c2d;

    const engine = Matter.Engine.create({ enableSleeping: false });
    engine.gravity.x = 0;
    engine.gravity.y = 0.72;
    engine.timing.timeScale = 0.86;
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
        mw: Math.max(baseRRef.current * 3.2, W * 0.065),
        neckLen: RY * 0.5,
      };
    }

    function geom(): JarGeom {
      return fixedGeomRef.current ?? liveGeom();
    }

    function baseRadius(count: number) {
      const g = liveGeom();
      const r = Math.sqrt((g.RX * g.RY * 0.6) / Math.max(1, count));
      return Math.max(Math.min(W, H) * 0.01, Math.min(Math.min(g.RX, g.RY) * 0.42, r));
    }

    function colorFor(id: string) {
      return COLORS[Math.floor(hash01(id + "c") * COLORS.length) % COLORS.length];
    }

    function setBallGateMask(b: Ball) {
      b.body.collisionFilter.category = BALL_CATEGORY;
      b.body.collisionFilter.mask = b.targeted ? TARGETED_MASK : BALL_MASK;
    }

    function spawn(e: Entry, baseR: number, g: JarGeom, mode: "inlet" | "body" = "inlet") {
      const x = mode === "inlet"
        ? g.cx + (hash01(e.id + "x") - 0.5) * g.mw * 1.05
        : g.cx + (hash01(e.id + "x") - 0.5) * g.RX * 1.35;
      const y = mode === "inlet"
        ? g.cy - g.RY - g.neckLen * (0.2 + hash01(e.id + "y") * 0.18)
        : g.cy - g.RY * (0.25 + hash01(e.id + "y") * 0.45);
      const body = Matter.Bodies.circle(x, y, baseR * 0.7, {
        friction: 0.09,
        frictionStatic: 0.05,
        frictionAir: 0.022,
        restitution: 0.28,
        density: 0.004,
        collisionFilter: { category: BALL_CATEGORY, mask: BALL_MASK },
      });
      Matter.Body.setVelocity(body, { x: (hash01(e.id + "vx") - 0.5) * 0.6, y: 1.4 });
      const b: Ball = {
        id: e.id,
        name: e.name,
        key: `${e.name}|${e.last4}`,
        body,
        r: baseR * 0.7,
        targetR: baseR,
        winner: false,
        targeted: false,
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

    function makeSegment(ax: number, ay: number, bx: number, by: number, thickness: number, label: string): Segment {
      const len = Math.hypot(bx - ax, by - ay);
      const body = Matter.Bodies.rectangle(0, 0, len, thickness, wallOptions(label));
      return { body, ax, ay, bx, by };
    }

    function updateSegment(seg: Segment, g: JarGeom, angle: number) {
      const a = rotatePoint(g.cx, g.cy, seg.ax, seg.ay, angle);
      const b = rotatePoint(g.cx, g.cy, seg.bx, seg.by, angle);
      Matter.Body.setPosition(seg.body, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      Matter.Body.setAngle(seg.body, Math.atan2(b.y - a.y, b.x - a.x));
    }

    function buildWalls(g: JarGeom) {
      const key = `${Math.round(W)}:${Math.round(H)}:${Math.round(g.mw)}:${Math.round(g.neckLen)}`;
      if (key === wallKeyRef.current) return;
      wallKeyRef.current = key;

      Matter.Composite.remove(engine.world, wallsRef.current.map((w) => w.body));
      if (gateRef.current) Matter.Composite.remove(engine.world, gateRef.current);
      if (corkRef.current) Matter.Composite.remove(engine.world, corkRef.current);
      wallsRef.current = [];

      const thickness = Math.max(14, baseRRef.current * 0.7);
      const shoulderY = -g.RY * 0.15;
      const wShoulder = g.RX * Math.sqrt(Math.max(0, 1 - (shoulderY / g.RY) ** 2));
      const outline: Array<{ y: number; half: number }> = [];
      for (let i = 0; i <= 28; i++) {
        const y = g.RY - (i / 28) * (g.RY - shoulderY);
        outline.push({ y, half: g.RX * Math.sqrt(Math.max(0, 1 - (y / g.RY) ** 2)) });
      }
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        outline.push({ y: shoulderY + (-g.RY - shoulderY) * t, half: wShoulder + (g.mw - wShoulder) * t });
      }
      outline.push({ y: -g.RY - g.neckLen, half: g.mw });

      for (let i = 0; i < outline.length - 1; i++) {
        const a = outline[i];
        const b = outline[i + 1];
        wallsRef.current.push(makeSegment(-a.half, a.y, -b.half, b.y, thickness, "jar-wall"));
        wallsRef.current.push(makeSegment(a.half, a.y, b.half, b.y, thickness, "jar-wall"));
      }
      wallsRef.current.push(makeSegment(-outline[0].half, outline[0].y, outline[0].half, outline[0].y, thickness, "jar-bottom"));

      gateRef.current = Matter.Bodies.rectangle(0, 0, g.mw * 1.15, thickness * 0.7, {
        isStatic: true,
        label: "winner-gate",
        friction: 0.08,
        restitution: 0.12,
        collisionFilter: { category: GATE_CATEGORY, mask: BALL_CATEGORY },
      });
      corkRef.current = Matter.Bodies.rectangle(0, 0, g.mw * 2.3, thickness * 1.25, {
        isStatic: true,
        label: "cork",
        friction: 0.08,
        restitution: 0.1,
        collisionFilter: { category: WALL_CATEGORY, mask: BALL_CATEGORY },
      });

      Matter.Composite.add(engine.world, [
        ...wallsRef.current.map((w) => w.body),
        gateRef.current,
        corkRef.current,
      ]);
    }

    function updateWalls(g: JarGeom, angle: number, drawing: boolean, corkOpenNow: boolean) {
      for (const wall of wallsRef.current) updateSegment(wall, g, angle);
      if (gateRef.current) {
        const p = rotatePoint(g.cx, g.cy, 0, -g.RY - g.neckLen * 0.18, angle);
        Matter.Body.setPosition(gateRef.current, p);
        Matter.Body.setAngle(gateRef.current, angle);
        gateRef.current.collisionFilter.mask = drawing ? BALL_CATEGORY : 0;
      }
      if (corkRef.current) {
        const p = rotatePoint(g.cx, g.cy, 0, -g.RY - g.neckLen - baseRRef.current * 0.45, angle);
        Matter.Body.setPosition(corkRef.current, p);
        Matter.Body.setAngle(corkRef.current, angle);
        corkRef.current.collisionFilter.mask = drawing && !corkOpenNow ? BALL_CATEGORY : 0;
      }
    }

    function scaleBall(b: Ball, targetR: number) {
      const next = b.r + (targetR - b.r) * 0.08;
      const ratio = next / Math.max(0.1, b.r);
      if (Math.abs(ratio - 1) > 0.002) {
        Matter.Body.scale(b.body, ratio, ratio);
        b.r = next;
      }
    }

    function localOf(g: JarGeom, angle: number, x: number, y: number) {
      const dx = x - g.cx;
      const dy = y - g.cy;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return { x: dx * c + dy * s, y: -dx * s + dy * c };
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
      const dt = lastNowRef.current ? Math.min(50, now - lastNowRef.current) : 16;
      lastNowRef.current = now;

      const drawing = scene === "DRAWING" || scene === "WINNERS";
      if (scene === "QR" || scene === "COLLECTING") {
        baseRRef.current = baseRadius(entries.length);
        drawBaseRRef.current = null;
        fixedGeomRef.current = null;
      } else if (drawBaseRRef.current !== null) {
        baseRRef.current = drawBaseRRef.current;
      }
      const baseR = baseRRef.current;
      const g = geom();

      if (scene === "QR" || scene === "COLLECTING") {
        for (const e of entries) {
          if (!byId.has(e.id) && !pendingIdsRef.current.has(e.id)) {
            pendingIdsRef.current.add(e.id);
            pendingRef.current.push(e);
          }
        }
        const spawnBudget = Math.max(4, Math.min(16, Math.floor(entries.length / 35) + 4));
        for (let i = 0; i < spawnBudget && pendingRef.current.length > 0; i++) {
          const e = pendingRef.current.shift()!;
          pendingIdsRef.current.delete(e.id);
          if (!byId.has(e.id)) spawn(e, baseR, g, "inlet");
        }
      }

      if (scene === "DRAWING" && drawStartRef.current === null) {
        while (pendingRef.current.length > 0) {
          const e = pendingRef.current.shift()!;
          pendingIdsRef.current.delete(e.id);
          if (!byId.has(e.id)) spawn(e, baseR, liveGeom(), "body");
        }
        drawBaseRRef.current = baseRRef.current;
        fixedGeomRef.current = liveGeom();
        wallKeyRef.current = "";
        drawStartRef.current = now;
        churnedRef.current = false;
        autoShakeAtRef.current = now;
        openElapsedRef.current = 0;
        targetedCountRef.current = 0;
        losersSnapRef.current = 0;
      }
      if (!drawing) {
        drawStartRef.current = null;
        churnedRef.current = false;
        autoShakeAtRef.current = 0;
        openElapsedRef.current = 0;
        targetedCountRef.current = 0;
        losersSnapRef.current = 0;
      }

      const fe = drawStartRef.current === null ? 0 : (now - drawStartRef.current) / FLIP_MS;
      const openFrac = openElapsedRef.current / Math.max(1000, durationMs);
      const autoTilt = drawing && corkOpen && winnerKeys.size > 0 ? AUTO_TILT_MAX * Math.min(1, Math.max(0, openFrac - 0.45) / 0.55) : 0;
      const angle = (drawing ? FLIP * easeInOut(Math.min(1, Math.max(0, fe))) + autoTilt + (tiltDeg * Math.PI) / 180 : 0);

      buildWalls(g);
      let remainingLosers = 0;
      for (const b of balls) {
        b.winner = winnerKeys.has(b.key);
        if (!b.winner) remainingLosers++;
      }
      const celebrate = drawing && winnerKeys.size > 0 && remainingLosers === 0;
      const holeOpen = drawing && winnerKeys.size > 0 && corkOpen && !celebrate;
      updateWalls(g, angle, drawing, corkOpen);

      for (const b of balls) {
        b.targetR = celebrate ? baseR * 1.5 : baseR;
        scaleBall(b, b.targetR);
        if (b.winner) {
          b.targeted = false;
          b.body.collisionFilter.mask = BALL_MASK;
        } else {
          setBallGateMask(b);
        }
      }

      if (drawing && fe > 0.45 && !churnedRef.current) {
        churnedRef.current = true;
        for (const b of balls) {
          Matter.Body.setVelocity(b.body, {
            x: b.body.velocity.x + (hash01(b.id + "cx") - 0.5) * 4.5,
            y: b.body.velocity.y + (hash01(b.id + "cy") - 0.5) * 4.5,
          });
        }
      }

      if (shakeSeq !== shakeRef.current) {
        shakeRef.current = shakeSeq;
        for (const b of balls) {
          Matter.Body.setVelocity(b.body, {
            x: b.body.velocity.x + (hash01(b.id + shakeSeq + "sx") - 0.5) * 6,
            y: b.body.velocity.y + (hash01(b.id + shakeSeq + "sy") - 0.5) * 6,
          });
        }
      }

      if (holeOpen) {
        if (losersSnapRef.current === 0) losersSnapRef.current = remainingLosers;
        openElapsedRef.current += dt;
        const frac = Math.min(1, openElapsedRef.current / Math.max(1000, durationMs));
        const scheduleFrac = Math.min(1, frac * 1.18);
        const targetGone = Math.floor(losersSnapRef.current * scheduleFrac);
        const mouth = rotatePoint(g.cx, g.cy, 0, -g.RY - g.neckLen * 0.45, angle);
        while (targetedCountRef.current < targetGone) {
          let best: Ball | null = null;
          let bestD = Infinity;
          for (const b of balls) {
            if (b.winner || b.targeted) continue;
            const d = (b.body.position.x - mouth.x) ** 2 + (b.body.position.y - mouth.y) ** 2;
            if (d < bestD) {
              bestD = d;
              best = b;
            }
          }
          if (!best) break;
          best.targeted = true;
          best.flashUntil = now + 300;
          setBallGateMask(best);
          targetedCountRef.current++;
        }
        if (frac > 0.55 && remainingLosers > 0 && now - autoShakeAtRef.current > AUTO_SHAKE_INTERVAL) {
          autoShakeAtRef.current = now;
          for (const b of balls) {
            Matter.Body.setVelocity(b.body, {
              x: b.body.velocity.x + (hash01(b.id + Math.floor(now) + "ax") - 0.5) * 3.4,
              y: b.body.velocity.y + (hash01(b.id + Math.floor(now) + "ay") - 0.5) * 3.4,
            });
          }
        }
      }

      Matter.Engine.update(engine, dt);

      if (scene === "QR" || scene === "COLLECTING") {
        for (const b of balls) {
          const p = b.body.position;
          const lp = localOf(g, 0, p.x, p.y);
          const spilledFromInlet = lp.y < -g.RY - g.neckLen * 0.08 && Math.abs(lp.x) > g.mw * 1.45;
          const outOfFrame = p.x < -80 || p.x > W + 80 || p.y < -120 || p.y > H + 160;
          if (spilledFromInlet || outOfFrame) {
            const x = g.cx + (hash01(b.id + "rx") - 0.5) * g.mw * 0.9;
            const y = g.cy - g.RY - g.neckLen * 0.28;
            Matter.Body.setPosition(b.body, { x, y });
            Matter.Body.setVelocity(b.body, { x: 0, y: 1.2 });
            Matter.Body.setAngularVelocity(b.body, 0);
          }
        }
      }

      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        const p = b.body.position;
        const lp = localOf(g, angle, p.x, p.y);
        if (b.targeted && (lp.y < -g.RY - g.neckLen - b.r || p.y - b.r > H + 160 || p.x < -160 || p.x > W + 160)) {
          Matter.Composite.remove(engine.world, b.body);
          byId.delete(b.id);
          balls.splice(i, 1);
        }
      }

      ctx.clearRect(0, 0, W, H);
      drawBottle(g, angle, corkOpen, celebrate);

      for (const b of balls) {
        const p = b.body.position;
        const flashing = now < b.flashUntil;
        const gold = celebrate;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = gold ? GOLD : colorFor(b.id);
        if (gold || flashing) {
          ctx.shadowColor = gold ? GOLD : "#ffffff";
          ctx.shadowBlur = flashing ? 24 : 18;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        const fs = b.r * 0.6;
        if (fs >= 9) {
          ctx.fillStyle = gold ? "#1a1400" : "rgba(255,255,255,0.96)";
          ctx.font = `700 ${Math.round(fs)}px -apple-system, "Noto Sans KR", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(b.name, p.x, p.y);
        }
      }

      rafRef.current = requestAnimationFrame(step);
    }

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
      for (const b of ballsRef.current) Matter.Composite.remove(engine.world, b.body);
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
    targetedCountRef.current = 0;
    losersSnapRef.current = 0;
    autoShakeAtRef.current = 0;
    churnedRef.current = false;
  }, [scene]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh" }}
    />
  );
}
