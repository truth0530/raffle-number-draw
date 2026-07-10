"use client";

import { useEffect, useRef, useState } from "react";
import { NState, NumItem, loadState, subscribe, defaultState } from "@/lib/numberStore";

function fitCols(w: number, h: number, n: number, aspect = 1.35) {
  let best = { cols: 1, size: 0 };
  for (let c = 1; c <= Math.max(1, n); c++) {
    const rows = Math.ceil(n / c);
    const size = Math.min(w / c, (h / rows) * aspect);
    if (size > best.size) best = { cols: c, size };
  }
  return best;
}

export default function NumbersShow() {
  const [state, setState] = useState<NState>(defaultState);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [showHint, setShowHint] = useState(true);
  const drawingRef = useRef(false);
  const rangeRef = useRef(400);
  const rainRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const apply = (s: NState) => {
      setState(s);
      drawingRef.current = s.drawing;
      rangeRef.current = s.rangeMax || 400;
    };
    apply(loadState());
    const unsub = subscribe(apply);
    return () => unsub();
  }, []);

  // 번호 비(rain) — 추첨 중에만. 지나간 번호 반복 없이 셔플 풀에서 흘려보냄.
  useEffect(() => {
    if (!rainRef.current) return;
    const canvas: HTMLCanvasElement = rainRef.current;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    const ctx: CanvasRenderingContext2D = c2d;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let cols: { x: number; items: { y: number; val: number }[] }[] = [];
    let pool: number[] = [];
    let pi = 0;
    let raf = 0;

    function shuffledPool() {
      const max = rangeRef.current;
      const arr = Array.from({ length: max }, (_, i) => i + 1);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    function nextVal() {
      if (pi >= pool.length) {
        pool = shuffledPool();
        pi = 0;
      }
      return pool[pi++];
    }
    function setup() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pool = shuffledPool();
      pi = 0;
      const gap = Math.max(80, Math.min(140, W / 14));
      const nCols = Math.floor(W / gap);
      cols = [];
      for (let c = 0; c < nCols; c++) {
        const items: { y: number; val: number }[] = [];
        const rows = 4;
        for (let r = 0; r < rows; r++) items.push({ y: (H / rows) * r - Math.random() * H, val: nextVal() });
        cols.push({ x: gap * (c + 0.5), items });
      }
    }
    setup();
    const onResize = () => setup();
    window.addEventListener("resize", onResize);

    const speed = 2.0; // px/frame (~120px/s, 읽을 수 있는 속도)
    function step() {
      if (drawingRef.current) {
        ctx.clearRect(0, 0, W, H);
        ctx.font = "700 40px -apple-system, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const col of cols) {
          for (const it of col.items) {
            it.y += speed;
            if (it.y > H + 30) {
              it.y = -30;
              it.val = nextVal();
            }
            const fade = 0.18 + 0.14 * Math.sin((it.y / H) * Math.PI);
            ctx.fillStyle = `rgba(255,210,74,${Math.max(0.08, fade)})`;
            ctx.fillText(String(it.val), col.x, it.y);
          }
        }
      } else {
        ctx.clearRect(0, 0, W, H);
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function goFullscreen() {
    setShowHint(false);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  const numbers = state.numbers;
  const drawing = state.drawing;
  const drawCount = state.drawCount;
  const main = numbers.filter((it) => it.status !== "absent");
  const absent = numbers.filter((it) => it.status === "absent");

  // 레이아웃 계산
  const hasAbsent = !drawing && absent.length > 0;
  const gridN = drawing ? drawCount : main.length || 1;
  const areaW = (hasAbsent ? 0.76 : 1) * vp.w - 40;
  const areaH = vp.h - 40;
  const { cols, size } = fitCols(areaW, areaH, gridN);
  const cardW = Math.max(40, size - 14);

  return (
    <main
      onClick={goFullscreen}
      style={{ height: "100dvh", width: "100vw", overflow: "hidden", background: "radial-gradient(120% 100% at 50% 0%, #14142a 0%, #0a0a0f 60%)", display: "flex", position: "relative" }}
    >
      <canvas ref={rainRef} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />

      <section style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minWidth: 0, position: "relative", zIndex: 1 }}>
        {!drawing && main.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8f7bff" }}>
            <div style={{ fontSize: "min(5vw, 52px)", fontWeight: 800, opacity: 0.7 }}>추첨을 기다리는 중…</div>
            {showHint && <div style={{ marginTop: 18, fontSize: "min(2.4vw, 22px)", opacity: 0.45 }}>화면을 클릭하면 전체화면</div>}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap: 14, justifyContent: "center", alignContent: "center" }}>
            {drawing
              ? Array.from({ length: drawCount }).map((_, i) => {
                  const it = numbers[i];
                  return it ? <Card key={it.n} item={it} w={cardW} landing /> : <Slot key={"e" + i} w={cardW} />;
                })
              : main.map((it) => <Card key={it.n} item={it} w={cardW} />)}
          </div>
        )}
      </section>

      {hasAbsent && (
        <aside style={{ width: "24vw", background: "rgba(244,63,94,0.07)", borderLeft: "2px solid rgba(244,63,94,0.3)", display: "flex", flexDirection: "column", padding: "2vh 1.2vw", overflow: "hidden", position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: "min(2.4vw, 26px)", fontWeight: 800, color: "#fb7185", marginBottom: "1.5vh" }}>없음 · 교체 대기 ({absent.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignContent: "flex-start", overflow: "auto" }}>
            {absent.map((it) => (
              <div key={it.n} style={{ minWidth: 74, padding: "10px 12px", borderRadius: 12, fontSize: "min(2.6vw, 34px)", fontWeight: 900, color: "#fecdd3", background: "rgba(244,63,94,0.18)", border: "2px solid rgba(251,113,133,0.5)" }}>
                {it.n}
              </div>
            ))}
          </div>
        </aside>
      )}

      <style>{`
        @keyframes skyfall {
          0%{transform:translateY(-120vh) rotate(-8deg);opacity:0}
          55%{opacity:1}
          72%{transform:translateY(7%) rotate(2deg)}
          86%{transform:translateY(-3%) rotate(-1deg)}
          100%{transform:translateY(0) rotate(0);opacity:1}
        }
        @keyframes lockglow { 0%{box-shadow:0 0 60px rgba(255,210,74,0.9)} 100%{box-shadow:0 8px 22px rgba(0,0,0,0.5)} }
      `}</style>
    </main>
  );
}

function Slot({ w }: { w: number }) {
  return <div style={{ width: w, height: w / 1.35, borderRadius: 18, background: "rgba(255,255,255,0.04)", border: "2px dashed rgba(255,255,255,0.12)" }} />;
}

function Card({ item, w, landing }: { item: NumItem; w: number; landing?: boolean }) {
  const received = item.status === "received";
  const added = item.added;
  const fs = Math.min(w * 0.5, 96);
  return (
    <div
      style={{
        width: w,
        height: w / 1.35,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 18,
        fontSize: fs,
        fontWeight: 900,
        color: received ? "#dbeafe" : added ? "#04120b" : "#141000",
        background: received ? "linear-gradient(180deg,#2b3b66,#1e293b)" : added ? "linear-gradient(180deg,#4ade80,#22c55e)" : "linear-gradient(180deg,#ffe27a,#ffcf3a)",
        border: added ? "4px solid #86efac" : received ? "3px solid #3b82f6" : "none",
        boxShadow: "0 8px 22px rgba(0,0,0,0.5)",
        opacity: received ? 0.85 : 1,
        animation: landing
          ? `skyfall 0.7s cubic-bezier(.2,.7,.3,1) both, lockglow 0.9s ease 0.7s both`
          : added
          ? `skyfall 0.9s cubic-bezier(.2,.7,.3,1) both`
          : undefined,
      }}
    >
      {item.n}
      {received && <span style={{ position: "absolute", top: 6, right: 10, fontSize: fs * 0.34, color: "#60a5fa" }}>✓</span>}
    </div>
  );
}
