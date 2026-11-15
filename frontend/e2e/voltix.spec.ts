import { expect, test, type Page } from "@playwright/test";

type Role = "user" | "operator" | "admin";

async function signIn(page: Page, role: Role, name: string) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email: `${name}@e2e.voltix.local`, name, role } });
  expect(res.ok()).toBeTruthy();
  const { token } = await res.json();
  await page.addInitScript((t) => window.localStorage.setItem("voltix.token", t), token);
  return token as string;
}

/** Fails the test on console errors, checks for sideways scroll, and saves a screenshot for review. */
async function check(page: Page, name: string, errors: string[]) {
  const project = test.info().project.name;
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
  // scroll through the page so sections that reveal on scroll are in their final state
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `../docs/screenshots/${name}-${project}.png`, fullPage: true });
  expect(errors, "no console errors").toEqual([]);
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // the live socket is optional (polling is the fallback), so a refused socket is not a defect
    if (m.type() === "error" && !/WebSocket|ws:\/\//.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("landing page", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("not all at once");
  await expect(page.getByText("Ready-by times met")).toBeVisible();
  await expect(page.getByRole("img", { name: /Transformer load across the day/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Three people, one schedule." })).toBeVisible();
  await check(page, "landing", errors);
});

test("public impact page and user guide", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/impact");
  await expect(page.getByText("Sessions completed")).toBeVisible();
  await check(page, "impact", errors);
  await page.goto("/guide");
  await expect(page.getByRole("heading", { name: "For drivers and residents" })).toBeVisible();
  await check(page, "guide", errors);
});

test("sign-in", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/app/live");
  await expect(page).toHaveURL(/\/signin/); // signed-out visitors are sent to sign in
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await check(page, "signin", errors);
  await page.getByRole("radio", { name: /Facility manager/ }).click();
  await page.getByLabel("Your name (optional)").fill(`E2E ${test.info().project.name}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app\/live/);
  await expect(page.getByRole("heading", { name: "Live site" })).toBeVisible();
});

test("operator live view", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, "operator", "operator");
  await page.goto("/app/live");
  await expect(page.getByText("Site load").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Site load over time/ })).toBeVisible();
  await expect(page.getByText("Sessions: planned vs actual")).toBeVisible();
  await expect(page.getByText("SIMULATED").first()).toBeVisible(); // simulated data is never shown as measured
  await check(page, "live", errors);
});

test("user plugs in, sees the start time and progress, and overrides", async ({ page }) => {
  const errors = watch(page);
  const name = `driver-${test.info().project.name}`;
  const token = await signIn(page, "user", name);
  // start clean: stop anything this user left running
  const mine = await (await page.request.get("/api/sessions/mine", { headers: { Authorization: `Bearer ${token}` } })).json();
  for (const s of mine) {
    if (["waiting", "charging", "paused"].includes(s.status)) {
      await page.request.post(`/api/sessions/${s.id}/override`, { headers: { Authorization: `Bearer ${token}` }, data: { action: "stop" } });
    }
  }
  await page.goto("/app/charge");
  const agree = page.getByRole("button", { name: "I agree" });
  await expect(agree.or(page.getByRole("button", { name: "I've plugged in" }))).toBeVisible();
  if (await agree.isVisible()) await agree.click();
  await expect(page.getByRole("button", { name: "I've plugged in" })).toBeVisible();
  await check(page, "charge-form", errors);

  await page.getByRole("button", { name: /E-scooter/ }).click();
  await page.locator("fieldset").nth(1).getByRole("button", { disabled: false }).first().click();
  // a ready-by time eight hours from now (IST), so the charge always fits whatever the clock says
  const ist = new Date(Date.now() + (330 + 8 * 60) * 60000);
  await page.locator('input[type="time"]').fill(`${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`);
  await page.getByRole("button", { name: "I've plugged in" }).click();

  await expect(page.getByText(/Starts at|Should finish by/)).toBeVisible();
  await expect(page.getByText(/^ready by/)).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await check(page, "charge-scheduled", errors);

  const now = page.getByRole("button", { name: "Charge now instead" });
  if (await now.isVisible()) await now.click(); // the override
  await expect(page.getByText("Charging now")).toBeVisible();
  await check(page, "charge-active", errors);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Stop and unplug" }).click();
  await expect(page.getByRole("button", { name: "I've plugged in" })).toBeVisible();

  await page.goto("/app/history");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await check(page, "history", errors);

  // Hindi toggle on the driver app
  await page.goto("/app/charge");
  await page.getByRole("button", { name: "हिं" }).click();
  await expect(page.getByRole("heading", { name: "मेरी चार्जिंग" })).toBeVisible();
  await check(page, "charge-hindi", errors);
  await page.getByRole("button", { name: "EN", exact: true }).click();
});

test("night report", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, "operator", "operator");
  await page.goto("/app/report");
  await expect(page.getByText("Ready-by times met")).toBeVisible();
  await expect(page.getByText("Audit chain")).toBeVisible();
  await expect(page.getByText("Intact")).toBeVisible();
  await check(page, "report", errors);
});

test("twin and adoption sweep", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, "operator", "operator");
  await page.goto("/app/twin");
  await expect(page.getByText(/adoption at which each strategy first overloads/i)).toBeVisible({ timeout: 80_000 });
  await expect(page.getByRole("img", { name: /EV adoption sweep/ })).toBeVisible();
  await page.getByRole("button", { name: "Hot-spot °C" }).click();
  await expect(page.getByRole("img", { name: /hot-spot temperature/ })).toBeVisible();
  await check(page, "twin", errors);
});

test("forecast, sessions and audit log", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, "operator", "operator");
  await page.goto("/app/forecast");
  await expect(page.getByText("P90 coverage")).toBeVisible();
  await check(page, "forecast", errors);
  await page.goto("/app/sessions");
  await expect(page.getByRole("table")).toBeVisible();
  await check(page, "sessions", errors);
  await page.goto("/app/audit");
  await expect(page.getByText("Chain intact")).toBeVisible();
  await check(page, "audit", errors);
});

test("admin pairs a plug", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, "admin", "admin");
  await page.goto("/app/admin");
  await expect(page.getByLabel("Site limit (kVA)")).toBeVisible();
  await check(page, "admin-site", errors);
  await page.getByRole("tab", { name: "Plugs & meters" }).click();
  const topic = `e2e_${test.info().project.name}_${Date.now()}`;
  await page.getByLabel("Name").first().fill("E2E bay");
  await page.getByLabel("MQTT topic / charge point ID").fill(topic);
  await page.getByRole("button", { name: "Pair plug" }).click();
  await expect(page.getByRole("cell", { name: topic })).toBeVisible();
  await check(page, "admin-devices", errors);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row", { name: new RegExp(topic) }).getByRole("button").click();
  await expect(page.getByRole("cell", { name: topic })).toHaveCount(0);
  await page.getByRole("tab", { name: "Tariff" }).click();
  await expect(page.getByText("Time-of-Day tariff")).toBeVisible();
  await check(page, "admin-tariff", errors);
});

test("Ask VOLTIX", async ({ page }) => {
  const errors = watch(page);
  const token = await signIn(page, "operator", "operator");
  const cfg = await (await page.request.get("/api/config")).json();
  await page.goto("/app/assistant");
  if (!cfg.assistant) {
    // No API key on this server: the feature hides itself and the endpoint is closed.
    await expect(page.getByText("The assistant is switched off")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ask VOLTIX" })).toHaveCount(0);
    const res = await page.request.post("/api/assistant/ask", { headers: { Authorization: `Bearer ${token}` }, data: { question: "hi", site_id: 1 } });
    expect(res.status()).toBe(404);
  } else {
    await page.getByLabel("Your question").fill("How did last night go?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Read from:")).toBeVisible({ timeout: 80_000 });
  }
  await check(page, "assistant", errors);
});

test("a driver cannot open operator screens", async ({ page }) => {
  await signIn(page, "user", `driver-${test.info().project.name}`);
  await page.goto("/app/live");
  await expect(page.getByText("You do not have access to this")).toBeVisible();
});
