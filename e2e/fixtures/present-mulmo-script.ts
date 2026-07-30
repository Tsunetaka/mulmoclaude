// Spec-local Playwright helpers for the presentMulmoScript plugin.
//
// The plugin's e2e suite (e2e/tests/present-mulmo-script.spec.ts) drives the
// same boot → ready → sidebar-select → assert-canvas sequence over and over.
// Centralizing those steps here keeps each test under the 20-line cognitive
// budget and pins the testid contract in one place — when the plugin's DOM
// shape changes, the helpers move, not every test.
//
// Since the View moved into @mulmoclaude/mulmoscript-plugin (phase 2), every
// backend call goes through ONE dispatch URL with a kind-discriminated JSON
// body, and responses are `{ ok: … }` envelopes — so the mocks here branch
// on `postDataJSON().kind` and `route.fallback()` for kinds they don't own.

import { expect, type Locator, type Page, type Route } from "@playwright/test";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

export const MULMO_DISPATCH_PATH = "/api/plugins/runtime/mulmoScript/dispatch";
const IMAGE_RENDER_TIMEOUT_MS = 5 * ONE_SECOND_MS;
// Generic "MovieGen failed" headline rendered by the chip regardless of locale
// is set in the plugin's lang/en.ts; tests pass the locale-agnostic English copy.
export const MOVIE_ERROR_HEADLINE = "Movie generation failed";

function dispatchKind(route: Route): string | undefined {
  const body: unknown = route.request().postDataJSON();
  return typeof body === "object" && body !== null ? (body as { kind?: string }).kind : undefined;
}

/**
 * Navigate to a session URL, wait for the app shell to be ready, and click
 * the sidebar Preview entry for the given script title.
 *
 * The "ready" check pins on the app-title testid in SidebarHeader so it
 * survives copy / locale tweaks. The Preview click goes through the
 * preview-title testid so a stray match elsewhere in the DOM (e.g. the
 * canvas heading rendering the same title) can't satisfy it.
 */
export async function openMulmoSessionAndSelectScript(page: Page, sessionPath: string): Promise<void> {
  await page.goto(sessionPath);
  await expect(page.getByTestId("app-title")).toBeVisible();
  await page.getByTestId("mulmo-script-preview-title").first().click();
}

/** Assert the canvas View has mounted by checking its script-title heading. */
export async function assertScriptHeader(page: Page, scriptTitle: string): Promise<void> {
  const heading = page.getByTestId("mulmo-script-title");
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(scriptTitle);
}

/**
 * Assert the inline movie-generation error chip is visible and contains the
 * given detail message. Returns the chip locator so the caller can scope
 * further interactions (e.g. clicking the retry button).
 */
export async function assertMovieErrorChip(page: Page, detail: string): Promise<Locator> {
  const chip = page.getByTestId("mulmo-script-movie-error-chip");
  await expect(chip).toBeVisible();
  await expect(chip.getByText(MOVIE_ERROR_HEADLINE)).toBeVisible();
  await expect(chip.getByText(detail)).toBeVisible();
  return chip;
}

/**
 * Mock the `renderBeat` dispatch kind with an `{ ok: true, image }` envelope.
 * Returns a snapshot accessor over the post bodies the SPA actually sent —
 * tests can assert against shape/count. Other kinds fall back to the
 * suite-level dispatch stub.
 */
export async function mockRenderBeatSuccess(page: Page, image: string): Promise<() => unknown[]> {
  const calls: unknown[] = [];
  await page.route(
    (url) => url.pathname === MULMO_DISPATCH_PATH,
    async (route) => {
      if (dispatchKind(route) !== "renderBeat") return route.fallback();
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, image } });
    },
  );
  return () => calls;
}

/** Mock the `renderBeat` dispatch kind with an `{ ok: false, error }` envelope. */
export async function mockRenderBeatError(page: Page, error: string): Promise<void> {
  await page.route(
    (url) => url.pathname === MULMO_DISPATCH_PATH,
    (route) => {
      if (dispatchKind(route) !== "renderBeat") return route.fallback();
      return route.fulfill({ json: { ok: false, code: "server_error", error } });
    },
  );
}

/**
 * Wait until at least one <img> in the DOM has a data-URI src matching the
 * given prefix. Used to confirm the mocked render-beat payload flowed
 * through to the View's <img>.
 */
export async function waitForRenderedBeatImage(page: Page, dataUriPrefix: string): Promise<void> {
  await page.waitForFunction((prefix) => Array.from(document.querySelectorAll("img")).some((img) => img.src.startsWith(prefix)), dataUriPrefix, {
    timeout: IMAGE_RENDER_TIMEOUT_MS,
  });
}

/**
 * Mock the long-held `generateMovie` dispatch kind to resolve with an
 * `{ ok: false, error }` envelope (the SSE stream's successor). Returns a
 * counter accessor so tests can assert how many times the kind was hit
 * (e.g. initial + retry).
 */
export async function mockGenerateMovieError(page: Page, message: string): Promise<() => number> {
  let calls = 0;
  await page.route(
    (url) => url.pathname === MULMO_DISPATCH_PATH,
    (route) => {
      if (dispatchKind(route) !== "generateMovie") return route.fallback();
      calls++;
      return route.fulfill({ json: { ok: false, code: "server_error", error: message } });
    },
  );
  return () => calls;
}
