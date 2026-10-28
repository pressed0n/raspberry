import { test } from "node:test";
import assert from "node:assert/strict";
import { HOSTED_AUTH_PENDING, hostedTransportError, requestAccessError } from "../src/server/access";

const HOSTED = { publicOrigin: "https://raspberry.mashina.ai" };

function h(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

/** Runs `work` with temporary environment values, always restoring them. */
function withEnv(values: Record<string, string | undefined>, work: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    work();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("local mode admits a loopback read", () => {
  withEnv({ RASPBERRY_AUTH_MODE: undefined, RASPBERRY_LOCAL_DEV: "1", APP_ORIGIN: "http://localhost:3000" }, () => {
    assert.equal(requestAccessError(h({ host: "localhost:3000" }), "GET"), null);
  });
});

test("local mode rejects a non-loopback host", () => {
  withEnv({ RASPBERRY_AUTH_MODE: undefined, RASPBERRY_LOCAL_DEV: "1", APP_ORIGIN: "http://localhost:3000" }, () => {
    assert.notEqual(requestAccessError(h({ host: "raspberry.mashina.ai" }), "GET"), null);
  });
});

test("local mode requires a same-origin browser request to mutate", () => {
  withEnv({ RASPBERRY_AUTH_MODE: undefined, RASPBERRY_LOCAL_DEV: "1", APP_ORIGIN: "http://localhost:3000" }, () => {
    assert.notEqual(requestAccessError(h({ host: "localhost:3000" }), "PATCH"), null);
    assert.equal(requestAccessError(h({ host: "localhost:3000", origin: "http://localhost:3000" }), "PATCH"), null);
    assert.notEqual(requestAccessError(h({ host: "localhost:3000", origin: "http://evil.example" }), "PATCH"), null);
  });
});

test("local mode stays closed when it is not enabled explicitly", () => {
  withEnv({ RASPBERRY_AUTH_MODE: undefined, RASPBERRY_LOCAL_DEV: undefined, APP_ORIGIN: "http://localhost:3000" }, () => {
    assert.notEqual(requestAccessError(h({ host: "localhost:3000" }), "GET"), null);
  });
});

test("hosted transport admits an allow-listed read", () => {
  assert.equal(hostedTransportError(h({ host: "raspberry.mashina.ai" }), "GET", HOSTED), null);
});

test("hosted transport rejects a plaintext public origin", () => {
  const error = hostedTransportError(h({ host: "raspberry.mashina.ai" }), "GET", { publicOrigin: "http://raspberry.mashina.ai" });
  assert.notEqual(error, null);
});

test("hosted transport rejects a public origin carrying a path", () => {
  const error = hostedTransportError(h({ host: "raspberry.mashina.ai" }), "GET", { publicOrigin: "https://raspberry.mashina.ai/app" });
  assert.notEqual(error, null);
});

test("hosted transport rejects a public origin carrying credentials", () => {
  const error = hostedTransportError(h({ host: "raspberry.mashina.ai" }), "GET", { publicOrigin: "https://user:secret@raspberry.mashina.ai" });
  assert.notEqual(error, null);
});

test("hosted transport rejects an unknown host", () => {
  assert.notEqual(hostedTransportError(h({ host: "evil.example" }), "GET", HOSTED), null);
});

test("hosted transport requires an allow-listed origin to mutate", () => {
  const host = "raspberry.mashina.ai";
  assert.notEqual(hostedTransportError(h({ host }), "POST", HOSTED), null);
  assert.equal(hostedTransportError(h({ host, origin: "https://raspberry.mashina.ai" }), "POST", HOSTED), null);
  assert.notEqual(hostedTransportError(h({ host, origin: "https://evil.example" }), "POST", HOSTED), null);
});

test("hosted transport rejects a cross-site mutation", () => {
  const headers = h({ host: "raspberry.mashina.ai", origin: "https://raspberry.mashina.ai", "sec-fetch-site": "cross-site" });
  assert.notEqual(hostedTransportError(headers, "PATCH", HOSTED), null);
});

test("hosted transport rejects a plaintext forward", () => {
  const headers = h({ host: "raspberry.mashina.ai", "x-forwarded-proto": "http" });
  assert.notEqual(hostedTransportError(headers, "GET", HOSTED), null);
  const secure = h({ host: "raspberry.mashina.ai", "x-forwarded-proto": "https" });
  assert.equal(hostedTransportError(secure, "GET", HOSTED), null);
});

test("hosted transport honours extra trusted hosts and origins", () => {
  const options = { publicOrigin: "https://raspberry.mashina.ai", trustedHosts: ["internal:3000"], extraOrigins: ["https://raspberry.example"] };
  assert.equal(hostedTransportError(h({ host: "internal:3000" }), "GET", options), null);
  assert.equal(hostedTransportError(h({ host: "raspberry.mashina.ai", origin: "https://raspberry.example" }), "PATCH", options), null);
});

test("hosted transport rejects an extra origin that is not https", () => {
  const options = { publicOrigin: "https://raspberry.mashina.ai", extraOrigins: ["http://raspberry.example"] };
  assert.notEqual(hostedTransportError(h({ host: "raspberry.mashina.ai" }), "GET", options), null);
});

test("session mode never admits a transport-valid request", () => {
  withEnv({ RASPBERRY_AUTH_MODE: "session", RASPBERRY_PUBLIC_ORIGIN: "https://raspberry.mashina.ai" }, () => {
    assert.equal(requestAccessError(h({ host: "raspberry.mashina.ai" }), "GET"), HOSTED_AUTH_PENDING);
    assert.equal(requestAccessError(h({ host: "raspberry.mashina.ai", origin: "https://raspberry.mashina.ai" }), "POST"), HOSTED_AUTH_PENDING);
  });
});

test("session mode reports a missing public origin instead of hanging open", () => {
  withEnv({ RASPBERRY_AUTH_MODE: "session", RASPBERRY_PUBLIC_ORIGIN: undefined }, () => {
    const error = requestAccessError(h({ host: "raspberry.mashina.ai" }), "GET");
    assert.notEqual(error, null);
    assert.notEqual(error, HOSTED_AUTH_PENDING);
  });
});
