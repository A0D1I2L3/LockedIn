import crypto from "node:crypto";
import { expect, test } from "@playwright/test";

const SECRET_KEY = process.env.SECRET_KEY || "e2e-test-secret";
const USER_ID = 1;

function sessionCookie(baseURL: string) {
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${USER_ID}.${nonce}`;
  const signature = crypto.createHmac("sha256", key).update(payload).digest("hex");
  return {
    name: "lockedin_session",
    value: `${payload}.${signature}`,
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([sessionCookie(baseURL!)]);
});

async function waitForDashboard(page: import("@playwright/test").Page) {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Smart Recruiter Parser" })).toBeVisible();
}

test("pastes an email, confirms the draft, and snoozes it", async ({ page }) => {
  await waitForDashboard(page);

  await page.getByRole("button", { name: /Paste & Draft/ }).click();
  const parser = page.getByRole("dialog");
  await parser
    .getByPlaceholder(/Paste the entire recruiter email/)
    .fill(
      "Thank you for applying to the Software Engineer Intern position at Acme E2E Labs. " +
        "We will review your application within 2 weeks.",
    );
  await parser.getByRole("button", { name: /Parse & Draft/ }).click();

  await expect(page.getByText("Smart Parser Draft")).toBeVisible();
  await expect(page.getByRole("dialog").locator("input").first()).toHaveValue("Acme E2E Labs");
  await page.getByRole("button", { name: /Confirm & Add/ }).click();
  await expect(page.getByText("Parsed email added to the pipeline")).toBeVisible();

  const card = page.getByRole("button", { name: /Acme E2E Labs/ }).first();
  await expect(card).toBeVisible();
  await card.click();

  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Acme E2E Labs");

  const before = await page.request.get("/api/applications");
  const beforeBody = (await before.json()) as {
    applications: Array<{ id: string; company: string; check_back_at: number | null }>;
  };
  const app = beforeBody.applications.find((entry) => entry.company === "Acme E2E Labs");
  expect(app).toBeTruthy();

  await detail.getByRole("button", { name: "+3d" }).click();
  await expect(page.getByText("Snoozed 3 days")).toBeVisible();

  const after = await page.request.get("/api/applications");
  const afterBody = (await after.json()) as {
    applications: Array<{ id: string; check_back_at: number | null }>;
  };
  const updated = afterBody.applications.find((entry) => entry.id === app!.id);
  expect(updated?.check_back_at).toBeGreaterThan(app!.check_back_at ?? 0);
});

test("updates a matched application instead of creating a duplicate", async ({ page }) => {
  const created = await page.request.post("/api/applications", {
    data: {
      company: "Acme Match E2E",
      role: "Software Intern",
      stage: "applied",
      job_url: "https://acmematch.example/jobs/1",
    },
  });
  expect(created.ok()).toBeTruthy();
  const application = (await created.json()) as { id: string; stage: string };

  await waitForDashboard(page);
  await page.getByRole("button", { name: /Paste & Draft/ }).click();
  await page
    .getByRole("dialog")
    .getByPlaceholder(/Paste the entire recruiter email/)
    .fill(
      "We would like to schedule an interview for the Software Intern role at Acme Match E2E. " +
        "Please reply with your availability.",
    );
  await page.getByRole("dialog").getByRole("button", { name: /Parse & Draft/ }).click();

  await expect(page.getByText("Matches Acme Match E2E · Software Intern")).toBeVisible();
  await page.getByRole("button", { name: /Update & attach/ }).click();
  await expect(page.getByText("Updated Acme Match E2E from the parsed email")).toBeVisible();

  const after = await page.request.get("/api/applications");
  const body = (await after.json()) as {
    applications: Array<{ id: string; company: string; stage: string }>;
  };
  const matches = body.applications.filter((entry) => entry.company === "Acme Match E2E");
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toBe(application.id);
  expect(matches[0].stage).toBe("interview");
});

test("drags an application to another stage and undoes the move", async ({ page }) => {
  const created = await page.request.post("/api/applications", {
    data: { company: "Drag E2E", role: "Drag Intern", stage: "applied" },
  });
  expect(created.ok()).toBeTruthy();

  await waitForDashboard(page);
  const card = page.getByRole("button", { name: /Drag E2E/ });
  await expect(card).toBeVisible();
  await card.dragTo(page.locator('[data-stage="assessment"]'));

  await expect(page.getByText("Moved to Assessment")).toBeVisible();
  await expect(
    page.locator('[data-stage="assessment"]').getByText("Drag E2E", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Move undone")).toBeVisible();
  await expect(
    page.locator('[data-stage="applied"]').getByText("Drag E2E", { exact: true }),
  ).toBeVisible();

  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByText("Moved to Assessment")).toBeVisible();
});

test("shows overdue work in Today and snoozes it", async ({ page }) => {
  const created = await page.request.post("/api/applications", {
    data: {
      company: "Today E2E",
      role: "Agenda Intern",
      stage: "applied",
      check_back_at: Date.now() - 86_400_000,
      next_action: "Send a follow-up note",
    },
  });
  expect(created.ok()).toBeTruthy();
  const application = (await created.json()) as { id: string; check_back_at: number };

  await waitForDashboard(page);
  const today = page.getByRole("region", { name: "Today" });
  await expect(today).toContainText("Overdue");
  await expect(today).toContainText("Today E2E");

  await today.getByRole("button", { name: "Snooze Today E2E 3 days" }).click();
  await expect(page.getByText("Snoozed Today E2E 3 days")).toBeVisible();

  const after = await page.request.get("/api/applications");
  const body = (await after.json()) as {
    applications: Array<{ id: string; check_back_at: number | null }>;
  };
  const updated = body.applications.find((entry) => entry.id === application.id);
  expect(updated?.check_back_at).toBeGreaterThan(application.check_back_at);
});

test("deletes an application and restores it from the undo toast", async ({ page }) => {
  const created = await page.request.post("/api/applications", {
    data: { company: "Trash E2E", role: "Undo Intern", stage: "applied" },
  });
  expect(created.ok()).toBeTruthy();

  await waitForDashboard(page);
  await page.getByRole("button", { name: /Trash E2E/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("You can undo right after");
    void dialog.accept();
  });
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByText("Trash E2E deleted")).toBeVisible();
  await expect(
    page.locator('[data-stage="applied"]').getByText("Trash E2E", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Application restored")).toBeVisible();
  await expect(
    page.locator('[data-stage="applied"]').getByText("Trash E2E", { exact: true }),
  ).toBeVisible();
});

test("deletes a logged email and restores it from the undo toast", async ({ page }) => {
  const created = await page.request.post("/api/applications", {
    data: { company: "Email Trash E2E", role: "Undo Email Intern", stage: "applied" },
  });
  expect(created.ok()).toBeTruthy();
  const application = (await created.json()) as { id: string };
  const email = await page.request.post(`/api/applications/${application.id}/emails`, {
    data: {
      raw_text:
        "Thank you for applying to the Undo Email Intern role at Email Trash E2E. " +
        "We will be in touch within 2 weeks.",
    },
  });
  expect(email.ok()).toBeTruthy();

  await waitForDashboard(page);
  await page.getByRole("button", { name: /Email Trash E2E/ }).first().click();
  const detail = page.getByRole("dialog");
  const deleteEmail = detail.getByRole("button", { name: "Delete logged email" });
  await expect(deleteEmail).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("You can undo right after");
    void dialog.accept();
  });
  await deleteEmail.click();

  await expect(page.getByText("Email deleted")).toBeVisible();
  await expect(deleteEmail).toHaveCount(0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Email restored")).toBeVisible();
  await expect(deleteEmail).toBeVisible();
});

test("adds an application manually and finds it with search", async ({ page }) => {
  await waitForDashboard(page);

  await page.getByRole("button", { name: "Add Application" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Company").fill("Globex E2E");
  await modal.getByLabel("Role").fill("Platform Intern");
  await modal.getByRole("button", { name: "Add application" }).click();

  await expect(page.getByText("Application added")).toBeVisible();
  await expect(page.getByRole("button", { name: /Globex E2E/ }).first()).toBeVisible();

  await page.getByPlaceholder("Search roles, companies...").fill("Globex");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByText("Globex E2E")).toBeVisible();
  await expect(page.getByText("Platform Intern")).toBeVisible();
});
