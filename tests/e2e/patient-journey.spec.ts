import { expect, test, type Page } from "@playwright/test";

import { cleanupTestPatient, getRawPatientByEmail } from "./support/appwrite";
import { expectNoSeriousA11yViolations, expectStyled, watchErrors } from "./support/page-checks";

// One patient, start to finish, through the real UI. Creates data in the Appwrite project
// from .env and removes it afterwards (see support/appwrite.ts). Notifications are disabled
// by playwright.config.ts, so the fake phone number never receives anything.
const STAMP = Date.now();
const EMAIL = `pkpcare-e2e+${STAMP}@example.com`;
const PHONE = `+1202555${String(STAMP).slice(-4)}`;
const ALLERGIES = "मूँगफली से एलर्जी (peanut allergy), carries an epinephrine pen";

// 1x1 PNG with valid magic bytes for the ID upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

test.describe.configure({ mode: "serial" });

let userId = "";

const next = async (page: Page, title: string) => {
  await page.getByRole("button", { name: new RegExp(`^next: ${title}`, "i") }).click();
};

test.afterAll(async () => {
  await cleanupTestPatient(EMAIL);
});

test("home page: get started creates the account and opens registration", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expectStyled(page);
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Full name").fill("E2E Patient");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Phone number", { exact: true }).fill(PHONE);
  await page.getByRole("button", { name: /get started/i }).click();

  await expect(page).toHaveURL(/\/patients\/[^/]+\/register/);
  userId = page.url().split("/patients/")[1].split("/")[0];
  expect(userId.length).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test("registration wizard: five steps, ID upload, consent, submit", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/patients/${userId}/register`);
  await expectStyled(page);

  // Step 1: Personal
  await expect(page.getByRole("heading", { name: /personal/i }).first()).toBeVisible();
  await page.getByLabel("Date of birth").fill("05/17/1990");
  await page.keyboard.press("Tab");
  await page.getByRole("radio", { name: "Other" }).click();
  await page.getByLabel("Address", { exact: true }).fill("1 Test Street, Testville");
  await page.getByLabel("Occupation").fill("Tester");
  await page.getByLabel("Emergency contact name").fill("E2E Contact");
  await page.getByLabel("Emergency contact number", { exact: true }).fill("+12025550100");
  await expectNoSeriousA11yViolations(page);
  await next(page, "Medical");

  // Step 2: Medical (non-Latin text proves the attribute-size fix end to end)
  await expect(page.getByRole("heading", { name: /medical/i }).first()).toBeVisible();
  await page.getByRole("combobox", { name: /primary care physician/i }).click();
  await page.getByRole("option", { name: /john green/i }).click();
  await page.getByLabel(/allergies/i).fill(ALLERGIES);
  await expectNoSeriousA11yViolations(page);
  await next(page, "Insurance");

  // Step 3: Insurance & ID, with an uploaded document
  await page.getByLabel("Insurance provider").fill("E2E Insurance");
  await page.getByLabel("Insurance policy number").fill("E2E-POLICY-123");
  await page.getByRole("combobox", { name: /identification type/i }).click();
  await page.getByRole("option").first().click();
  await page.getByLabel(/identification number/i).fill("E2E-ID-99887");
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-id.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expectNoSeriousA11yViolations(page);
  await next(page, "Consent");

  // Step 4: Consent (three separate, unticked boxes)
  for (const id of ["treatmentConsent", "disclosureConsent", "privacyConsent"]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-checked", "false");
    await page.locator(`#${id}`).click();
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-checked", "true");
  }
  await expectNoSeriousA11yViolations(page);
  await next(page, "Review");

  // Step 5: Review and submit
  await expect(page.getByText("E2E Patient").first()).toBeVisible();
  await page.getByRole("button", { name: /submit and continue/i }).click();

  await expect(page).toHaveURL(/\/new-appointment/);
  expect(errors).toEqual([]);
});

test("sensitive fields are encrypted at rest", async () => {
  const raw = await getRawPatientByEmail(EMAIL);
  expect(raw, "patient document was created").not.toBeNull();
  for (const field of ["allergies", "insurancePolicyNumber", "identificationNumber"]) {
    expect(String(raw![field]), `${field} is ciphertext`).toMatch(/^enc:v1:/);
    expect(String(raw![field])).not.toContain("epinephrine");
  }
  expect(String(raw!.identificationDocumentId ?? ""), "ID file stored").not.toBe("");
});

test("booking: pick a doctor and a real open slot, then request it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/patients/${userId}/new-appointment`);
  await expectStyled(page);

  await page.getByRole("combobox", { name: /doctor/i }).click();
  await page.getByRole("option", { name: /john green/i }).click();

  const days = page.getByRole("radiogroup", { name: /choose a day/i });
  await expect(days).toBeVisible();
  await days.getByRole("radio").first().click();
  await page
    .getByRole("radiogroup", { name: /available times/i })
    .getByRole("radio")
    .first()
    .click();

  await page.getByLabel(/reason for visit/i).fill("E2E check-up");
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: /request appointment/i }).click();

  await expect(page).toHaveURL(/new-appointment\/success/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  expect(errors).toEqual([]);
});

test("dashboard: the booking is listed and can be cancelled", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/patients/${userId}`);
  await expectStyled(page);

  const cancel = page.getByRole("button", { name: /cancel appointment/i }).first();
  await expect(cancel).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await cancel.click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("E2E cleanup");
  await dialog.getByRole("button", { name: /cancel appointment|confirm|yes/i }).last().click();

  await expect(page.getByText(/was cancelled|cancelled/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("privacy page: consents, export and deletion request are available", async ({ page }) => {
  await page.goto(`/patients/${userId}/privacy`);
  await expectStyled(page);
  await expect(page.getByRole("heading", { name: /privacy/i }).first()).toBeVisible();
  await expect(page.getByText(/consent to treatment/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /download my data/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /delet/i }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
