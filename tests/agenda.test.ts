import { describe, expect, it } from "vitest";
import type { Application } from "@/lib/types";
import { agendaBuckets } from "@/components/pipeline-utils";

const now = new Date(2026, 4, 10, 12, 0, 0, 0).getTime();
const day = 86_400_000;

function app(fields: Partial<Application> = {}): Application {
  return {
    id: "app",
    user_id: 1,
    company: "Acme",
    role: "Intern",
    location: "",
    job_url: "",
    source: "",
    stage: "applied",
    status: "active",
    action_state: "waiting",
    next_action: "",
    next_action_at: null,
    check_back_at: null,
    check_back_source: "none",
    apply_by: null,
    applied_at: null,
    last_contact_at: null,
    follow_up_count: 0,
    notes: "",
    created_at: now,
    updated_at: now,
    closed_at: null,
    ...fields,
  };
}

describe("agendaBuckets", () => {
  it("splits active applications into overdue, today, and this week", () => {
    const buckets = agendaBuckets(
      [
        app({ id: "past", check_back_at: now - day }),
        app({ id: "today", next_action_at: now + 60_000 }),
        app({ id: "week", check_back_at: now + 3 * day }),
        app({ id: "later", check_back_at: now + 10 * day }),
        app({ id: "closed", status: "closed", check_back_at: now - day }),
      ],
      now,
    );

    expect(buckets.overdue.map((item) => item.app.id)).toEqual(["past"]);
    expect(buckets.today.map((item) => item.app.id)).toEqual(["today"]);
    expect(buckets.week.map((item) => item.app.id)).toEqual(["week"]);
  });

  it("uses the earliest due date and reports its kind", () => {
    const buckets = agendaBuckets(
      [
        app({
          id: "both",
          check_back_at: now + 2 * day,
          next_action_at: now - day,
        }),
      ],
      now,
    );

    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.overdue[0].kind).toBe("next_action");
    expect(buckets.week).toHaveLength(0);
  });

  it("skips applications without any date", () => {
    expect(agendaBuckets([app()], now)).toEqual({ overdue: [], today: [], week: [] });
  });
});
