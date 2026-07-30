// Unit tests for the mulmoserver OAuth broker client: response contracts,
// refresh-token preservation, and the error wording the agent surfaces.
// The broker itself is stubbed via a local HTTP server — no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { brokerBaseUrl, brokerExchange, brokerRefresh, brokerStart } from "@mulmoclaude/core/google";

interface StubRoute {
  status?: number;
  body: unknown;
}

const startStubBroker = async (
  routes: Record<string, StubRoute>,
): Promise<{ baseUrl: string; close: () => void; requests: { url: string; body: string }[] }> => {
  const requests: { url: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      requests.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString() });
      const route = routes[path];
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(route.status ?? 200, { "Content-Type": "application/json" });
      res.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => server.close(), requests };
};

describe("brokerBaseUrl", () => {
  it("defaults to the shipped broker", () => {
    assert.equal(brokerBaseUrl(undefined), "https://asia-northeast1-mulmoserver.cloudfunctions.net");
  });

  it("honours an override (fork / staging deploy)", () => {
    assert.equal(brokerBaseUrl("https://example.test"), "https://example.test");
  });

  it("strips trailing slashes so path joins stay well-formed", () => {
    assert.equal(brokerBaseUrl("https://example.test///"), "https://example.test");
  });
});

describe("brokerStart", () => {
  it("passes port + code_challenge and returns the signed auth url", async () => {
    const stub = await startStubBroker({
      "/googleOAuthStart": { body: { auth_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "signed-state" } },
    });
    try {
      const result = await brokerStart(51234, "c".repeat(43), stub.baseUrl);
      assert.deepEqual(result, { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "signed-state" });
      assert.match(stub.requests[0]?.url ?? "", /port=51234/);
      assert.match(stub.requests[0]?.url ?? "", /code_challenge=c{43}/);
    } finally {
      stub.close();
    }
  });

  it("rejects a malformed response instead of proceeding with a broken flow", async () => {
    const stub = await startStubBroker({ "/googleOAuthStart": { body: { auth_url: "https://x.test" } } });
    try {
      await assert.rejects(brokerStart(51234, "c".repeat(43), stub.baseUrl), /unexpected response/);
    } finally {
      stub.close();
    }
  });

  it("surfaces a broker HTTP error", async () => {
    const stub = await startStubBroker({ "/googleOAuthStart": { status: 400, body: { error: "port must be an integer" } } });
    try {
      await assert.rejects(brokerStart(1, "c".repeat(43), stub.baseUrl), /HTTP 400/);
    } finally {
      stub.close();
    }
  });

  it("reports an unreachable broker in words the agent can relay", async () => {
    // Port 1 on loopback is not listening — connection refused.
    await assert.rejects(brokerStart(51234, "c".repeat(43), "http://127.0.0.1:1"), /unreachable/);
  });
});

describe("brokerExchange", () => {
  it("posts code + state + verifier and returns the credentials", async () => {
    const stub = await startStubBroker({
      "/googleOAuthExchange": { body: { access_token: "at", refresh_token: "rt", expiry_date: 1234 } },
    });
    try {
      const credentials = await brokerExchange({ code: "auth-code", state: "signed-state", codeVerifier: "v".repeat(43) }, stub.baseUrl);
      assert.deepEqual(credentials, { access_token: "at", refresh_token: "rt", expiry_date: 1234 });
      assert.deepEqual(JSON.parse(stub.requests[0]?.body ?? "{}"), { code: "auth-code", state: "signed-state", code_verifier: "v".repeat(43) });
    } finally {
      stub.close();
    }
  });

  it("rejects when the broker returns no refresh token — the link would not survive", async () => {
    const stub = await startStubBroker({ "/googleOAuthExchange": { body: { access_token: "at" } } });
    try {
      await assert.rejects(brokerExchange({ code: "c", state: "s", codeVerifier: "v" }, stub.baseUrl), /no refresh token/);
    } finally {
      stub.close();
    }
  });

  it("rejects when the broker returns no access token", async () => {
    const stub = await startStubBroker({ "/googleOAuthExchange": { body: { refresh_token: "rt" } } });
    try {
      await assert.rejects(brokerExchange({ code: "c", state: "s", codeVerifier: "v" }, stub.baseUrl), /no access token/);
    } finally {
      stub.close();
    }
  });
});

describe("brokerRefresh", () => {
  it("keeps the caller's refresh token — the refresh reply never echoes it", async () => {
    const stub = await startStubBroker({ "/googleOAuthRefresh": { body: { access_token: "fresh", expiry_date: 999 } } });
    try {
      const credentials = await brokerRefresh("rt-1", stub.baseUrl);
      assert.deepEqual(credentials, { access_token: "fresh", refresh_token: "rt-1", expiry_date: 999 });
      assert.deepEqual(JSON.parse(stub.requests[0]?.body ?? "{}"), { refresh_token: "rt-1" });
    } finally {
      stub.close();
    }
  });

  it("adopts a rotated refresh token when the broker sends one", async () => {
    const stub = await startStubBroker({ "/googleOAuthRefresh": { body: { access_token: "fresh", refresh_token: "rt-2" } } });
    try {
      const credentials = await brokerRefresh("rt-1", stub.baseUrl);
      assert.equal(credentials.refresh_token, "rt-2");
    } finally {
      stub.close();
    }
  });

  it("surfaces a revoked grant (broker answers 400 opaquely)", async () => {
    const stub = await startStubBroker({ "/googleOAuthRefresh": { status: 400, body: { error: "refresh failed" } } });
    try {
      await assert.rejects(brokerRefresh("rt-1", stub.baseUrl), /HTTP 400/);
    } finally {
      stub.close();
    }
  });

  it("surfaces rate limiting", async () => {
    const stub = await startStubBroker({ "/googleOAuthRefresh": { status: 429, body: { error: "too many requests" } } });
    try {
      await assert.rejects(brokerRefresh("rt-1", stub.baseUrl), /HTTP 429/);
    } finally {
      stub.close();
    }
  });
});

describe("broker transport safety", () => {
  // Codes, PKCE verifiers and refresh tokens travel to these endpoints.
  it("refuses a cleartext broker on a remote host", async () => {
    await assert.rejects(brokerStart(51234, "c".repeat(43), "http://broker.example.test"), /must be reached over HTTPS/);
  });

  it("refuses cleartext for exchange and refresh too", async () => {
    await assert.rejects(brokerExchange({ code: "c", state: "s", codeVerifier: "v" }, "http://broker.example.test"), /must be reached over HTTPS/);
    await assert.rejects(brokerRefresh("rt", "http://broker.example.test"), /must be reached over HTTPS/);
  });

  it("allows loopback over http — it never leaves the machine (and is where tests stub it)", async () => {
    const stub = await startStubBroker({ "/googleOAuthRefresh": { body: { access_token: "fresh" } } });
    try {
      assert.equal((await brokerRefresh("rt", stub.baseUrl)).access_token, "fresh");
    } finally {
      stub.close();
    }
  });

  it("rejects a malformed override rather than guessing", async () => {
    await assert.rejects(brokerStart(51234, "c".repeat(43), "not-a-url"), /invalid Google sign-in service URL/);
  });
});

// The auth URL is opened in the user's browser, and the broker base URL is
// overridable — so the answer must be Google's consent page, nothing else.
describe("brokerStart consent-URL validation", () => {
  const withStub = async (authUrl: string, assertion: (baseUrl: string) => Promise<void>): Promise<void> => {
    const stub = await startStubBroker({ "/googleOAuthStart": { body: { auth_url: authUrl, state: "s" } } });
    try {
      await assertion(stub.baseUrl);
    } finally {
      stub.close();
    }
  };

  it("accepts Google's consent page", async () => {
    await withStub("https://accounts.google.com/o/oauth2/v2/auth?client_id=x", async (baseUrl) => {
      assert.match((await brokerStart(51234, "c".repeat(43), baseUrl)).authUrl, /accounts\.google\.com/);
    });
  });

  it("refuses a look-alike host", async () => {
    await withStub("https://accounts.google.com.evil.test/o/oauth2/v2/auth", async (baseUrl) => {
      await assert.rejects(brokerStart(51234, "c".repeat(43), baseUrl), /not Google's consent page/);
    });
  });

  it("refuses a cleartext consent page", async () => {
    await withStub("http://accounts.google.com/o/oauth2/v2/auth", async (baseUrl) => {
      await assert.rejects(brokerStart(51234, "c".repeat(43), baseUrl), /not Google's consent page/);
    });
  });

  it("refuses an unparseable URL", async () => {
    await withStub("not-a-url", async (baseUrl) => {
      await assert.rejects(brokerStart(51234, "c".repeat(43), baseUrl), /unusable authorization URL/);
    });
  });

  it("reports a non-JSON reply (proxy / captive portal) in actionable words", async () => {
    const stub = await startStubBroker({ "/googleOAuthRefresh": { body: "<html>captive portal</html>" } });
    try {
      await assert.rejects(brokerRefresh("rt", stub.baseUrl), /malformed response/);
    } finally {
      stub.close();
    }
  });
});
