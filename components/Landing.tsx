"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { SettingsModal } from "@/components/SettingsModal";
import { Icon } from "@/components/ui";

interface StatusPayload {
  authenticated: boolean;
  oauth_configured: boolean;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24">
      <path
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.04h3.87c2.26-2.09 3.67-5.17 3.67-9.14z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.04c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.13C3.26 21.31 7.34 24 12 24z"
        fill="#34A853"
      />
      <path
        d="M5.27 14.25c-.25-.72-.38-1.49-.38-2.25s.13-1.53.38-2.25V6.62H1.27C.46 8.23 0 10.06 0 12s.46 3.77 1.27 5.38l4-3.13z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.69 1.27 6.62l4 3.13c.95-2.85 3.6-4.96 6.73-4.96z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function Landing() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<StatusPayload>("/api/status")
      .then((payload) => {
        if (cancelled) return;
        setStatus(payload);
        if (payload.authenticated) {
          router.replace("/app");
          return;
        }
        if (new URLSearchParams(window.location.search).get("settings") === "1") {
          setSettingsOpen(true);
          window.history.replaceState({}, "", "/");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ authenticated: false, oauth_configured: false });
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let time = 0;
    const config = { amplitude: 48, swell: 0.85, speed: 0.013, lightAngle: 125 };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    const render = () => {
      time += config.speed;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0d111c";
      ctx.fillRect(0, 0, width, height);

      const layers = [
        {
          colorA: "rgba(66, 91, 154, 0.45)",
          colorB: "rgba(118, 192, 236, 0.15)",
          freq: 0.0015,
          ampMult: 1.15,
          phase: 0,
        },
        {
          colorA: "rgba(42, 68, 130, 0.55)",
          colorB: "rgba(66, 91, 154, 0.28)",
          freq: 0.002,
          ampMult: 0.9,
          phase: 2.3,
        },
        {
          colorA: "rgba(118, 192, 236, 0.35)",
          colorB: "rgba(255, 149, 165, 0.1)",
          freq: 0.0018,
          ampMult: 1,
          phase: 4.5,
        },
      ];

      layers.forEach((layer, index) => {
        ctx.beginPath();
        const baseHeight = height * (0.44 + index * 0.13);
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 10) {
          const wave1 =
            Math.sin(x * layer.freq + time + layer.phase) * (config.amplitude * layer.ampMult);
          const wave2 =
            Math.cos(x * layer.freq * 0.72 - time * 0.75) *
            (config.amplitude * 0.48 * config.swell);
          const y = baseHeight + wave1 + wave2;
          if (x === 0) ctx.lineTo(0, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();

        const rad = (config.lightAngle * Math.PI) / 180;
        const gradient = ctx.createLinearGradient(0, 0, Math.cos(rad) * width, Math.sin(rad) * height);
        gradient.addColorStop(0, layer.colorA);
        gradient.addColorStop(1, layer.colorB);
        ctx.fillStyle = gradient;
        ctx.fill();
      });

      frame = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(render);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  function startSignIn() {
    setConnecting(true);
    if (status && !status.oauth_configured) {
      setSettingsOpen(true);
      setConnecting(false);
      setToast("Add your Google OAuth client ID and secret to continue.");
      return;
    }
    window.location.href = "/oauth/login";
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-base font-manrope text-cream">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-[#425B9A]/25 blur-[130px]" />
        <div className="absolute -right-40 top-1/2 h-[520px] w-[520px] rounded-full bg-[#76C0EC]/15 blur-[150px]" />
        <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-[#FF95A5]/10 blur-[140px]" />
      </div>

      <button
        onClick={() => setSettingsOpen(true)}
        className="absolute right-5 top-5 z-20 inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-high/60 px-3 py-1.5 text-[11px] font-semibold text-text-secondary backdrop-blur-md transition hover:border-cyan/50 hover:text-cream sm:right-8 sm:top-8"
      >
        <Icon name="settings" className="text-[15px]" /> Setup
      </button>

      <main className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-4 py-10 select-none sm:px-6 md:px-10">
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />

        <div className="pointer-events-none absolute -top-32 left-1/2 h-[380px] w-[720px] -translate-x-1/2 rounded-full bg-[#425B9A]/20 blur-[150px]" />
        <div className="pointer-events-none absolute bottom-[-100px] left-1/2 h-[320px] w-[620px] -translate-x-1/2 rounded-full bg-[#76C0EC]/15 blur-[140px]" />

        <div className="animate-rise-in relative z-10 flex w-full max-w-2xl flex-col items-center rounded-[2.5rem] border border-outline-variant/30 bg-surface-container-lowest/70 p-8 text-center shadow-[0_20px_60px_-15px_rgba(13,17,28,0.85)] backdrop-blur-2xl sm:p-12 md:p-16">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container-high/80 px-3.5 py-1.5 shadow-sm backdrop-blur-md">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant">
              Career Telemetry • Private Auth
            </span>
          </div>

          <h1 className="mb-5 bg-gradient-to-r from-[#FFF6DC] via-[#76C0EC] to-[#425B9A] bg-clip-text font-display text-[46px] font-bold leading-[1.05] tracking-[-0.03em] text-transparent sm:text-[54px] sm:leading-[62px]">
            LockedIn
          </h1>

          <p className="mb-4 max-w-lg font-display text-lg font-medium leading-relaxed tracking-[-0.01em] text-[#FFF6DC]/95 sm:text-xl">
            The private, rules-first internship application pipeline. Zero Gmail inbox access. Pure
            recruitment velocity.
          </p>

          <p className="mb-10 flex max-w-md items-center justify-center gap-1.5 text-[13px] leading-5 text-[#b5c1d6]">
            <Icon name="verified_user" className="text-[16px] text-cyan" />
            Google Sign-in used solely for identity verification; never reads or stores your emails.
          </p>

          <div className="group relative">
            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-[#425B9A] via-[#76C0EC] to-[#FF95A5] opacity-40 blur-md transition duration-500 group-hover:opacity-85 group-hover:blur-lg" />
            <button
              type="button"
              onClick={startSignIn}
              aria-label="Continue with Google"
              className="relative flex items-center justify-center gap-3.5 rounded-full border border-[#76C0EC]/30 bg-[#0d111c] px-8 py-3.5 text-sm font-semibold text-[#FFF6DC] shadow-lg transition-all duration-300 hover:bg-[#161c2d] active:scale-[0.98]"
            >
              {connecting ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan/30 border-t-cyan" />
                  <span className="tracking-wide">Connecting…</span>
                </>
              ) : (
                <>
                  <GoogleMark />
                  <span className="font-medium tracking-wide">Continue with Google</span>
                </>
              )}
            </button>
          </div>

          {status && !status.oauth_configured && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="mt-4 text-[11px] font-semibold text-cyan/80 underline-offset-4 hover:text-cyan hover:underline"
            >
              Google OAuth setup required — add credentials
            </button>
          )}

          <div className="mt-8 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-outline">
            <span className="text-[#b5c1d6]/80">Secure enclave active</span>
            <span className="text-[#FF95A5]/60">•</span>
            <span className="text-[#b5c1d6]/80">Zero log retention</span>
          </div>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        authenticated={false}
        onSaved={async () => {
          try {
            setStatus(await api<StatusPayload>("/api/status"));
          } catch {
            // status refresh is best-effort
          }
        }}
        notify={(message) => setToast(message)}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-cyan/30 bg-surface/95 px-4 py-2 text-xs font-medium text-cream shadow-2xl backdrop-blur-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
