// E2E coverage for the "+" add-view target chooser in CollectionView. On this
// host `fetchRemoteView` is always bound (src/composables/collections/uiHost.ts),
// so the "+" opens a two-item menu — custom (desktop) view vs phone view — and
// each choice seeds a general-role chat with a target-specific prompt:
//
//   desktop → the classic custom-view prompt (capabilities ["read"] / ["read","write"])
//   phone   → the custom-view-remote prompt (`target: "mobile"` registration)
//
// Pinned here: the menu renders both options, outside-click dismisses it, and
// the two seeded /api/agent messages are distinct and point at the right help.
// (The no-`fetchRemoteView` fallback — "+" seeding the desktop prompt directly
// with no menu — belongs to hosts without the remote-view binding, e.g.
// MulmoTerminal, and isn't constructible in this app's e2e harness.)

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const TASKS = {
  collection: {
    slug: "tasks",
    title: "Tasks",
    icon: "checklist",
    source: "project",
    schema: {
      title: "Tasks",
      icon: "checklist",
      dataPath: "data/tasks/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        title: { type: "string", label: "Title" },
      },
    },
  },
  items: [{ id: "a", title: "Write spec" }],
};

async function setup(page: Page): Promise<void> {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/tasks",
    (route) => route.fulfill({ json: TASKS }),
  );
}

async function seedFromMenu(page: Page, itemTestId: string): Promise<{ message: string; roleId: string }> {
  await page.getByTestId("collection-view-add").click();
  const agentPost = page.waitForRequest((req) => req.url().endsWith("/api/agent") && req.method() === "POST");
  await page.getByTestId(itemTestId).click();
  return (await agentPost).postDataJSON();
}

test.describe("collection + add-view target chooser", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
    await page.goto("/collections/tasks");
  });

  test("+ opens the chooser with both targets; outside-click dismisses it", async ({ page }) => {
    await page.getByTestId("collection-view-add").click();
    await expect(page.getByTestId("collection-view-add-menu")).toBeVisible();
    await expect(page.getByTestId("collection-view-add-desktop")).toBeVisible();
    await expect(page.getByTestId("collection-view-add-mobile")).toBeVisible();

    // Clicking elsewhere closes the menu without seeding a chat.
    await page.getByTestId("collection-view-toggle-table").click();
    await expect(page.getByTestId("collection-view-add-menu")).toHaveCount(0);
  });

  test("custom view seeds the desktop prompt", async ({ page }) => {
    const body = await seedFromMenu(page, "collection-view-add-desktop");

    expect(body.roleId).toBe("general");
    expect(body.message).toContain("data/skills/tasks/views/your-view.html");
    expect(body.message).toContain('capabilities ["read"]');
    expect(body.message).not.toContain('target: "mobile"');

    await expect(page.getByTestId("collection-view-add-menu")).toHaveCount(0);
  });

  test("phone view seeds the mobile (remote) prompt", async ({ page }) => {
    const body = await seedFromMenu(page, "collection-view-add-mobile");

    expect(body.roleId).toBe("general");
    expect(body.message).toContain("data/skills/tasks/views/your-view.html");
    expect(body.message).toContain('target: "mobile"');
    expect(body.message).toContain("custom-view-remote");
  });
});
