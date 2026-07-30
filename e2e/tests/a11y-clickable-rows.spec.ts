// E2E regression guard for the clickable-region a11y contract added
// in #684: non-<button> elements with @click= handlers must be
// keyboard-activatable via Enter / Space.
//
// Scoped to one representative site (the session-history side panel's
// session-row div) to keep the suite cheap. The same contract is
// applied to four other sites (todo list/table/kanban); those share
// the code path and are covered by manual verification.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A } from "../fixtures/sessions";

async function openSidePanel(page: Page): Promise<void> {
  await page.goto("/chat");
  await page.getByTestId("session-history-toggle-off").click();
  await expect(page.getByTestId("session-history-side-panel")).toBeVisible();
}

test.describe("clickable-region a11y", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("Enter on a focused session-history row loads the session", async ({ page }) => {
    await openSidePanel(page);
    const row = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(row).toBeVisible();

    // Programmatic focus (matching what keyboard users land on after
    // Tab-walking past the filter pills).
    await row.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));
  });

  test("Space on a focused session-history row loads the session", async ({ page }) => {
    await openSidePanel(page);
    const row = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(row).toBeVisible();

    await row.focus();
    await page.keyboard.press("Space");

    await expect(page).toHaveURL(new RegExp(`/chat/${SESSION_A.id}`));
  });

  test("session-history row advertises role=button and an aria-label", async ({ page }) => {
    await openSidePanel(page);
    const row = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("role", "button");
    await expect(row).toHaveAttribute("tabindex", "0");
    // aria-label is interpolated from the session preview; content
    // may vary with locale / fixture, so only assert presence here.
    const label = await row.getAttribute("aria-label");
    expect(label).toBeTruthy();
  });

  test("auto-repeat (keydown with event.repeat) does not re-fire activation", async ({ page }) => {
    // Held Space / Enter on a native <button> activates once per
    // physical press, not per OS auto-repeat tick. Mirror that by
    // ignoring events where `event.repeat === true`.
    await openSidePanel(page);
    const row = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(row).toBeVisible();
    const startUrl = page.url();

    await row.evaluate((rowEl) => {
      rowEl.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, repeat: true }));
    });

    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- negative assertion: an auto-repeat keydown must NOT navigate; the absence of a navigation has no observable signal to synchronize on.
    await page.waitForTimeout(100);
    expect(page.url()).toBe(startUrl);
  });

  test("focused session-history row does not fire activation when Space is pressed on a non-self target", async ({ page }) => {
    // Regression guard for the `.self` modifier added to keydown
    // handlers. The session row currently has no inner interactive
    // control, but future additions (e.g., a menu button) could
    // bubble a keydown up and hijack the row's own activation.
    // Simulate that by programmatically dispatching a Space keydown
    // with a non-self target on the row, then confirming no
    // navigation occurred.
    await openSidePanel(page);
    const row = page.getByTestId(`session-item-${SESSION_A.id}`);
    await expect(row).toBeVisible();
    const startUrl = page.url();

    await row.evaluate((rowEl) => {
      // Synthetic keydown event whose target is a CHILD span inside
      // the row, not the row itself. With `.self`, the handler must
      // skip. Without it, the handler would fire and navigate away.
      const child = rowEl.querySelector("span") ?? rowEl;
      child.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    });

    // Give the event loop a chance to process a navigation that
    // would happen in the broken case.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- negative assertion: a non-self-target Space keydown must NOT navigate; the absence of a navigation has no observable signal to synchronize on.
    await page.waitForTimeout(100);
    expect(page.url()).toBe(startUrl);
  });
});
