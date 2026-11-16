export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("@/lib/db");
  const { runNotificationSweep } = await import("@/lib/notify");
  const timer = setInterval(() => {
    void runNotificationSweep(getDb()).catch((error) => {
      console.error("[instrumentation] notification sweep failed", error);
    });
  }, 60_000);
  timer.unref?.();
}
