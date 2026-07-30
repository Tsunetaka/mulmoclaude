// Pseudo-E2E for IME Enter handling (useImeAwareEnter composable).
//
// Real IME input can't be automated in Playwright, so we dispatch
// synthetic compositionstart / compositionend / keydown events in
// the correct browser-specific order to verify the composable's
// suppression logic wired into the textarea.
//
// "Sent" is detected by intercepting POST /api/agent calls — if the
// array is empty after a simulated keypress sequence, no message was
// dispatched.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { chatInput, fillChatInput } from "../fixtures/chat";

// The events in a real IME confirmation arrive within microseconds of
// each other (same JS microtask in Safari). Every `await
// page.evaluate(...)` hop crosses the test-runner ↔ browser boundary,
// which in CI can exceed the composable's 30 ms race window. So we
// dispatch whole sequences inside a single `evaluate` — one hop, one
// JS turn, deterministic timing regardless of CI load.

type ImeStep = { kind: "composition"; type: "compositionstart" | "compositionend" } | { kind: "keydown"; isComposing: boolean; shiftKey?: boolean };

async function dispatchImeSequence(textarea: ReturnType<typeof chatInput>, steps: readonly ImeStep[]) {
  await textarea.evaluate((elem, stepList) => {
    for (const step of stepList) {
      if (step.kind === "composition") {
        elem.dispatchEvent(new CompositionEvent(step.type, { bubbles: true }));
      } else {
        elem.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            isComposing: step.isComposing,
            shiftKey: step.shiftKey ?? false,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }
  }, steps);
}

test.describe("IME Enter handling", () => {
  let agentCalls: string[];

  test.beforeEach(async ({ page }) => {
    agentCalls = [];
    await mockAllApis(page);

    // Track POST /api/agent calls to detect sends.
    await page.route(
      (url) => url.pathname === "/api/agent",
      (route) => {
        if (route.request().method() === "POST") {
          agentCalls.push(route.request().postData() ?? "");
          return route.fulfill({
            status: 202,
            json: { chatSessionId: "mock-session" },
          });
        }
        return route.fallback();
      },
    );

    await page.goto("/");
    await expect(page.getByTestId("user-input")).toBeVisible();
  });

  test("Chrome IME: compositionstart → keydown(isComposing) → compositionend does not send", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "テスト");

    // Chrome order: compositionstart → keydown(Enter, isComposing=true) → compositionend.
    // The `isComposing: true` flag alone blocks the send; no timing
    // dependency here, but we still batch for consistency.
    await dispatchImeSequence(input, [
      { kind: "composition", type: "compositionstart" },
      { kind: "keydown", isComposing: true },
      { kind: "composition", type: "compositionend" },
    ]);

    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- negative assertion: an isComposing keydown must NOT send; the absence of an /api/agent POST has no observable signal.
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);
  });

  test("Safari IME: compositionstart → compositionend → keydown(isComposing=false) does not send", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "テスト");

    // Safari order: compositionstart → compositionend → keydown(Enter, isComposing=false).
    // The composable's 30 ms post-compositionend race window is what
    // suppresses the send. We batch inside one evaluate() so the gap
    // between compositionend and keydown is microseconds (same JS
    // turn) rather than a full round-trip, which in slow CI webkit
    // can exceed 30 ms and flake this test.
    await dispatchImeSequence(input, [
      { kind: "composition", type: "compositionstart" },
      { kind: "composition", type: "compositionend" },
      { kind: "keydown", isComposing: false },
    ]);

    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- the send is suppressed by the composable's 30 ms post-compositionend race window; asserting "not sent" requires waiting past it, and the absence of a POST has no observable signal.
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);
  });

  test("normal Enter after IME confirmation sends the message", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "テスト");

    // Complete an IME sequence first (Safari order), atomically.
    await dispatchImeSequence(input, [
      { kind: "composition", type: "compositionstart" },
      { kind: "composition", type: "compositionend" },
      { kind: "keydown", isComposing: false },
    ]);

    // Wait past the 30 ms race window, then send a real Enter.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- must let the composable's 30 ms post-compositionend race window elapse before asserting no send; the window closing has no observable signal.
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);

    await dispatchImeSequence(input, [{ kind: "keydown", isComposing: false }]);
    await expect.poll(() => agentCalls.length).toBe(1);
  });

  test("Shift+Enter does not send", async ({ page }) => {
    const input = chatInput(page);
    await fillChatInput(page, "改行テスト");

    await dispatchImeSequence(input, [{ kind: "keydown", isComposing: false, shiftKey: true }]);

    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- negative assertion: Shift+Enter must NOT send; the absence of an /api/agent POST has no observable signal.
    await page.waitForTimeout(100);
    expect(agentCalls).toHaveLength(0);
  });
});
