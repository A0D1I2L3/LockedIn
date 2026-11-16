"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="font-display text-lg font-bold text-cream">Something went wrong</p>
        <p className="mt-2 text-xs leading-relaxed text-cream-muted">
          {error.message || "The page hit an unexpected error."}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-cyan/40 bg-cyan/10 px-4 py-2 text-xs font-semibold text-cyan hover:bg-cyan/20"
          >
            Try again
          </button>
          <a
            href="/app"
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-cream-muted hover:text-cream"
          >
            Back to pipeline
          </a>
        </div>
      </div>
    </div>
  );
}
