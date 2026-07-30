// Unit tests for the OAuth loopback callback listener: state-first
// validation, wrong-state requests can't abort the flow, and accurate
// success/failure responses. No Google network calls — only the local
// HTTP server is exercised.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { waitForAuthCode } from "@mulmoclaude/core/google";

const TEST_TIMEOUT_MS = 5_000;

const startServer = (): Promise<{ server: http.Server; port: number }> =>
  new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });

const getCallback = async (port: number, query: string): Promise<{ status: number; body: string }> => {
  const response = await fetch(`http://127.0.0.1:${port}/oauth2callback?${query}`);
  return { status: response.status, body: await response.text() };
};

describe("waitForAuthCode", () => {
  it("resolves with the code when the state matches", async () => {
    const { server, port } = await startServer();
    try {
      const pending = waitForAuthCode(server, "expected", TEST_TIMEOUT_MS);
      const { status, body } = await getCallback(port, "state=expected&code=auth-code-1");
      assert.equal(status, 200);
      assert.match(body, /Authorization complete/);
      assert.equal(await pending, "auth-code-1");
    } finally {
      server.close();
    }
  });

  it("keeps waiting when a request carries the wrong state, then accepts the real callback", async () => {
    const { server, port } = await startServer();
    try {
      const pending = waitForAuthCode(server, "expected", TEST_TIMEOUT_MS);
      const foreign = await getCallback(port, "state=evil&error=access_denied");
      assert.equal(foreign.status, 400);
      assert.match(foreign.body, /Invalid authorization callback/);
      const genuine = await getCallback(port, "state=expected&code=auth-code-2");
      assert.equal(genuine.status, 200);
      assert.equal(await pending, "auth-code-2");
    } finally {
      server.close();
    }
  });

  it("rejects when Google reports an error with a valid state", async () => {
    const { server, port } = await startServer();
    try {
      const pending = waitForAuthCode(server, "expected", TEST_TIMEOUT_MS);
      // Attached before the request fires — the rejection can precede the
      // HTTP response, and an unhandled rejection would fail the test.
      const expectation = assert.rejects(pending, /Google authorization failed: access_denied/);
      const { status, body } = await getCallback(port, "state=expected&error=access_denied");
      assert.equal(status, 400);
      assert.match(body, /Authorization failed/);
      assert.doesNotMatch(body, /access_denied/);
      await expectation;
    } finally {
      server.close();
    }
  });

  it("rejects when the callback carries no code", async () => {
    const { server, port } = await startServer();
    try {
      const pending = waitForAuthCode(server, "expected", TEST_TIMEOUT_MS);
      const expectation = assert.rejects(pending, /carried no code/);
      await getCallback(port, "state=expected");
      await expectation;
    } finally {
      server.close();
    }
  });

  it("responds 404 to unrelated paths without settling the flow", async () => {
    const { server, port } = await startServer();
    try {
      const pending = waitForAuthCode(server, "expected", TEST_TIMEOUT_MS);
      const response = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
      assert.equal(response.status, 404);
      await getCallback(port, "state=expected&code=still-works");
      assert.equal(await pending, "still-works");
    } finally {
      server.close();
    }
  });

  it("times out when no callback ever arrives", async () => {
    const { server } = await startServer();
    try {
      await assert.rejects(waitForAuthCode(server, "expected", 100), /authorization timed out/);
    } finally {
      server.close();
    }
  });

  it("rejects with 'cancelled' when the signal aborts mid-wait", async () => {
    const { server } = await startServer();
    const controller = new AbortController();
    try {
      const pending = waitForAuthCode(server, "expected", TEST_TIMEOUT_MS, controller.signal);
      const expectation = assert.rejects(pending, /authorization cancelled/);
      controller.abort();
      await expectation;
    } finally {
      server.close();
    }
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { server } = await startServer();
    const controller = new AbortController();
    controller.abort();
    try {
      await assert.rejects(waitForAuthCode(server, "expected", TEST_TIMEOUT_MS, controller.signal), /authorization cancelled/);
    } finally {
      server.close();
    }
  });
});
