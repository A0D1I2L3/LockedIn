"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import LiquidChrome from "./LiquidChrome";

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
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showChrome, setShowChrome] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      let webgl = false;
      try {
        const canvas = document.createElement("canvas");
        webgl = Boolean(canvas.getContext("webgl2"));
      } catch {
        webgl = false;
      }
      setShowChrome(!media.matches && webgl);
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const onPageShow = () => setConnecting(false);
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<StatusPayload>("/api/status")
      .then((payload) => {
        if (cancelled) return;
        setStatus(payload);
        if (payload.authenticated) {
          router.replace("/app");
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

  function startSignIn() {
    setConnecting(true);
    if (status && !status.oauth_configured) {
      setConnecting(false);
      setToast("Google sign-in is not configured on this deployment.");
      return;
    }
    window.location.href = "/oauth/login";
  }

  const pending = status === null || connecting;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-base font-manrope text-cream">
      {/* Full-screen background: static gradient fallback for reduced motion or no WebGL. */}
      <div className="fixed inset-0 z-0 bg-[radial-gradient(circle_at_30%_20%,#1b3352_0%,#0e131f_45%,#070b13_100%)]">
        {showChrome && (
          <LiquidChrome
            color="#76C0EC"
            speed={0.14}
            amplitude={0.22}
            detail={3}
            thickness={1.15}
            interactive
            frequencyX={2.5}
            frequencyY={2.5}
            depth={1}
            roughness={0.2}
            exposure={1}
            rippleStrength={1}
            rippleSize={1}
            tilt={1}
            intro
            lightMode={false}
          />
        )}
      </div>

      {/* main ignores the mouse so the chrome stays interactive;
          the card turns pointer events back on */}
      <main className="pointer-events-none relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-10 select-none">
        <div className="pointer-events-auto animate-rise-in flex max-w-[92vw] flex-col items-center rounded-3xl bg-black/20 px-8 py-10 text-center sm:px-14 sm:py-12">
          <h1
            className="bg-gradient-to-r from-[#FFF6DC] via-[#76C0EC] to-[#425B9A] bg-clip-text font-display text-[56px] font-extrabold leading-none tracking-[-0.04em] text-transparent sm:text-[88px] md:text-[112px]"
            style={{ filter: "drop-shadow(0 4px 24px rgba(7,11,19,0.6))" }}
          >
            LockedIn
          </h1>

          <p
            className="mb-10 mt-4 max-w-md text-sm font-medium leading-6 sm:text-base"
            style={{
              color: "#ffffff",
              textShadow: "0 2px 16px rgba(7,11,19,0.9), 0 1px 2px rgba(7,11,19,0.9)",
            }}
          >
            Your private internship pipeline. Track applications, deadlines and follow-ups in one place.
          </p>

          <div className="group relative">
            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-[#425B9A] via-[#76C0EC] to-[#FF95A5] opacity-40 blur-md transition duration-500 group-hover:opacity-85 group-hover:blur-lg" />
            <button
              type="button"
              onClick={startSignIn}
              disabled={pending}
              aria-label="Continue with Google"
              className="relative flex items-center justify-center gap-3.5 rounded-full border border-[#76C0EC]/30 bg-[#0d111c] px-8 py-3.5 text-sm font-semibold text-[#FFF6DC] shadow-lg transition-all duration-300 hover:bg-[#161c2d] active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
            >
              {pending ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan/30 border-t-cyan" />
                  <span className="tracking-wide">
                    {status === null ? "Checking…" : "Connecting…"}
                  </span>
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
            <p
              className="mt-5 text-xs font-semibold text-white"
              style={{ textShadow: "0 2px 12px rgba(7,11,19,0.9)" }}
            >
              Google sign-in is not configured on this deployment.
            </p>
          )}
        </div>
      </main>

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-cyan/30 bg-surface/95 px-4 py-2 text-xs font-medium text-cream shadow-2xl backdrop-blur-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
