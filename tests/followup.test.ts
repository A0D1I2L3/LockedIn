import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@/lib/db";
import { defaultVariant, draftFollowUp, templateFollowUp } from "@/lib/followup";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockedin-followup-"));
  db = createDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("follow-up drafts", () => {
  it("uses a safe template without an AI key", async () => {
    const userId = db.getOrCreateUser("fup-1", "fup@example.com");
    const app = db.createApplication(userId, {
      company: "Acme",
      role: "Software Intern",
      stage: "applied",
      applied_at: Date.now() - 6 * 86_400_000,
    });
    const draft = await draftFollowUp(db, userId, app);
    expect(draft.generator).toBe("template");
    expect(draft.subject).toContain("Software Intern");
    expect(draft.body).toContain("Acme");
    expect(draft.body).toContain("6 days");
  });

  it("picks the right variant for the stage", () => {
    const base = {
      stage: "applied",
    } as Parameters<typeof defaultVariant>[0];
    expect(defaultVariant(base)).toBe("follow_up");
    expect(defaultVariant({ ...base, stage: "interview" })).toBe("thank_you");
    expect(defaultVariant({ ...base, stage: "offer" })).toBe("offer_nudge");
  });

  it("renders thank-you and decline variants", () => {
    const app = {
      company: "Globex",
      role: "Data Intern",
      applied_at: null,
      last_contact_at: null,
      apply_by: null,
      next_action_at: null,
    } as Parameters<typeof templateFollowUp>[0];
    expect(templateFollowUp(app, "thank_you").subject).toContain("Thank you");
    expect(templateFollowUp(app, "decline").body).toContain("another opportunity");
  });
});
