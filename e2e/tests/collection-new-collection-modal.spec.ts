// E2E for the "New collection" chooser modal: clicking "+ Collection" on the
// Collections index opens a modal offering a free-form chat, the guided
// (presentForm-driven) setup, and ten ready-made starter templates — instead of
// the old behavior of immediately launching the guided chat. Guards that opening
// the modal starts no chat, that Guided setup still auto-sends the create prompt,
// and that a starter seeds an EDITABLE DRAFT (not an auto-send).
// See plans/done/feat-collection-starters-modal.md.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const COLLECTIONS_LIST = {
  collections: [{ slug: "reading-list", title: "Reading List", icon: "bookmark", source: "user" }],
};

async function mockCollections(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections",
    (route) => route.fulfill({ json: COLLECTIONS_LIST }),
  );
}

// Capture agent runs (the auto-send sink) so we can tell an auto-sent chat
// (Guided setup) apart from a draft-only seed (a starter template). Registered
// after mockAllApis so it wins Playwright's reverse-order route matching.
async function captureAgentRuns(page: Page): Promise<string[]> {
  const messages: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/agent",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      messages.push(route.request().postData() ?? "");
      return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
    },
  );
  return messages;
}

test.describe("new collection modal", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockCollections(page);
  });

  test("opening the modal shows the chooser and starts no chat", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    await page.getByTestId("collections-add-collection").click();

    await expect(page.getByTestId("new-collection-freeform")).toBeVisible();
    await expect(page.getByTestId("new-collection-guided")).toBeVisible();
    await expect(page.getByTestId("new-collection-starter-todos")).toBeVisible();
    await expect(page.getByTestId("new-collection-starter-portfolio")).toBeVisible();

    // Merely opening the chooser must not launch anything.
    await page.waitForTimeout(0.2 * ONE_SECOND_MS);
    expect(agentRuns).toHaveLength(0);
  });

  test("Guided setup auto-sends the presentForm create prompt", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    await page.getByTestId("collections-add-collection").click();
    await page.getByTestId("new-collection-guided").click();

    await expect.poll(() => agentRuns.length, { timeout: 2 * ONE_SECOND_MS }).toBe(1);
    expect(agentRuns[0]).toContain("collection-skills.md");
    expect(agentRuns[0]).toContain("presentForm");
  });

  test("a starter seeds its prompt as an editable draft (no auto-send)", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    await page.getByTestId("collections-add-collection").click();
    await page.getByTestId("new-collection-starter-todos").click();

    // Draft path: a new chat opens with the prompt pre-filled in the composer,
    // and nothing is sent until the user hits Send.
    await expect(page).not.toHaveURL(/\/collections$/);
    await expect(page.getByTestId("user-input")).toHaveValue(/todo-collection\.md/);
    await page.waitForTimeout(0.25 * ONE_SECOND_MS);
    expect(agentRuns).toHaveLength(0);
  });

  test("Free-form seeds the conventions preamble as a draft (no auto-send)", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    await page.getByTestId("collections-add-collection").click();
    await page.getByTestId("new-collection-freeform").click();

    // Free-form is not a blank chat: it seeds the conventions-reading preamble as
    // an editable draft, pointing the LLM at collection-skills.md, and auto-sends nothing.
    await expect(page).not.toHaveURL(/\/collections$/);
    await expect(page.getByTestId("user-input")).toHaveValue(/collection-skills\.md/);
    await page.waitForTimeout(0.25 * ONE_SECOND_MS);
    expect(agentRuns).toHaveLength(0);
  });
});
