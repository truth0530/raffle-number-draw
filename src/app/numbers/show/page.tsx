"use client";

import { useEffect, useRef, useState } from "react";
import { NState, NumItem, loadState, subscribe, defaultState, sendPresence, subscribePresence } from "@/lib/numberStore";

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
  const [isFs, setIsFs] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  // 안내 슬라이드(행운권 추첨 안내) — "추첨을 기다리는 중" 앞에 먼저 보이는 첫 화면.
  // 이 페이지 로컬 상태로만 관리한다(스토어·프레즌스 채널은 발표자 모드 구현이 소유 — 무충돌).
  const [intro, setIntro] = useState(true);
  const introRef = useRef(true);
  introRef.current = intro;
  const drawingRef = useRef(false);
  const rangeRef = useRef(400);
  const rainRef = useRef<HTMLCanvasElement | null>(null);

  // preview=1 로 열리면(관리자 발표자 미리보기 iframe) 실제 무대가 아니므로,
  // 하트비트·전체화면·복구안내를 모두 끈다 — 미리보기가 "쇼 열림"으로 오인되지 않게.
  useEffect(() => {
    setIsPreview(new URLSearchParams(window.location.search).get("preview") === "1");
  }, []);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 실제 무대 창일 때만: 살아있음 하트비트를 관리자에게 보낸다(1.5초). 닫힐 때 bye.
  // 관리자의 "슬라이드쇼 창 열기 → 앞으로 가져오기" 요청(focus-show)에 응답한다.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("preview") === "1") return;
    sendPresence({ type: "show-alive" });
    const beat = setInterval(() => sendPresence({ type: "show-alive" }), 1500);
    const unsub = subscribePresence((m) => {
      if (m.type === "focus-show") {
        try {
          window.focus();
        } catch {
          /* 포커스 불가(브라우저 정책) — 무해 */
        }
      }
    });
    const bye = () => sendPresence({ type: "show-bye" });
    window.addEventListener("beforeunload", bye);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(beat);
      unsub();
      window.removeEventListener("beforeunload", bye);
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, []);

  // 전체화면 상태 추적 — 어떤 이유로든 해제되면(네이티브 대화상자 등) 복구 안내를 다시 띄운다.
  // 화면 아무 곳이나 클릭하면 goFullscreen 이 실행되므로 한 번의 클릭으로 복귀된다.
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    onFs();
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
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

  // 안내 ↔ 대기 화면 전환: PowerPoint 슬라이드처럼 키보드로 넘긴다.
  // 클릭은 이미 전체화면 복구용이라(오클릭으로 안내가 넘어가는 사고 방지) 키 입력만 쓴다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const fwd = e.key === " " || e.key === "Enter" || e.key === "ArrowRight" || e.key === "PageDown";
      const back = e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "PageUp";
      if (!fwd && !back) return;
      e.preventDefault();
      setIntro(back);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 관리자 미리보기(iframe)가 실제 무대의 안내/대기 화면을 따라오게 하는 전용 소형 채널.
  // 발표자 모드의 프레즌스/상태 채널과 별개 이름을 써서 서로 간섭하지 않는다.
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const ch = new BroadcastChannel("numberIntroMirror");
    const preview = new URLSearchParams(window.location.search).get("preview") === "1";
    if (preview) {
      const h = (e: MessageEvent) => {
        if (e.data && typeof e.data.intro === "boolean") setIntro(e.data.intro);
      };
      ch.addEventListener("message", h);
      return () => {
        ch.removeEventListener("message", h);
        ch.close();
      };
    }
    const tick = setInterval(() => ch.postMessage({ intro: introRef.current }), 1500);
    return () => {
      clearInterval(tick);
      ch.close();
    };
  }, []);

  function goFullscreen() {
    if (isPreview) return; // 미리보기(iframe)에서는 전체화면 요청 안 함
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  const numbers = state.numbers;
  const drawing = state.drawing;
  const drawCount = state.drawCount;
  const main = numbers.filter((it) => it.status !== "absent");
  const absent = numbers.filter((it) => it.status === "absent");

  // 안내 슬라이드는 추첨이 시작되기 전까지만 — 추첨이 시작되면 무조건 그리드에 양보.
  const introVisible = intro && !drawing && main.length === 0;

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

      {/* 전체화면이 아니면(=어떤 이유로 풀렸으면) 항상 복구 안내. 화면 클릭으로 즉시 복귀. */}
      {!isPreview && !isFs && (main.length > 0 || drawing) && (
        <div
          style={{
            position: "fixed",
            top: 14,
            right: 16,
            zIndex: 5,
            padding: "8px 16px",
            borderRadius: 999,
            background: "rgba(109,92,255,0.22)",
            border: "1px solid rgba(109,92,255,0.55)",
            color: "#c9c2ff",
            fontSize: 15,
            fontWeight: 700,
            pointerEvents: "none",
          }}
        >
          화면을 클릭하면 전체화면
        </div>
      )}

      {/* 안내 슬라이드(첫 화면) — 원본 PPT의 좌측 포스터·양피지 배경 그대로, 멘트는 맑은고딕 계열로.
          Space/→ 로 "추첨 대기" 화면으로 넘기고, ←/Backspace 로 되돌아온다. 추첨 시작 시 자동 소멸. */}
      {introVisible && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", background: "#f6ecd6 url(/numbers-intro/bg.jpeg) repeat" }}>
          <img
            src="/numbers-intro/poster.png"
            alt="행사 안내 포스터"
            style={{ height: "100%", width: "auto", flexShrink: 0, boxShadow: "12px 0 44px rgba(0,0,0,0.16)" }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 5vw", minWidth: 0 }}>
            <h1 style={{ fontSize: "min(5vw, 72px)", fontWeight: 800, color: "#1F3A5F", letterSpacing: "-0.02em", margin: 0, fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif' }}>
              행운권 추첨 안내
            </h1>
            <div style={{ marginTop: "5vh", fontSize: "min(2.4vw, 34px)", color: "#3A3A3A", lineHeight: 1.75, wordBreak: "keep-all", maxWidth: 900, display: "flex", flexDirection: "column", gap: "3.5vh", fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif' }}>
              <p style={{ margin: 0 }}>
                특강이 마친 후 추첨을 통해 강사 목사님께서 집필하신 <b style={{ color: "#1F3A5F" }}>도서를 선물로 드립니다</b>.
              </p>
              <p style={{ margin: 0 }}>
                행운권을 못 받으신 분들은 쉬는 시간을 이용해서 <b style={{ color: "#1F3A5F" }}>입구 데스크</b>에서 받으셔도 됩니다.
              </p>
            </div>
          </div>
          {!isPreview && (
            <div style={{ position: "absolute", right: 18, bottom: 14, fontSize: 13.5, color: "rgba(31,58,95,0.5)", fontWeight: 600 }}>
              Space·→ 다음 화면{!isFs ? " | 화면 클릭 전체화면" : ""}
            </div>
          )}
        </div>
      )}

      <section style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minWidth: 0, position: "relative", zIndex: 1 }}>
        {!drawing && main.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8f7bff" }}>
            <div style={{ fontSize: "min(5vw, 52px)", fontWeight: 800, opacity: 0.7 }}>추첨을 기다리는 중…</div>
            {!isPreview && !isFs && <div style={{ marginTop: 18, fontSize: "min(2.4vw, 22px)", opacity: 0.45 }}>화면을 클릭하면 전체화면</div>}
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
