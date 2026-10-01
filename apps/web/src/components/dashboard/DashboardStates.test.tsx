// Copyright (c) 2026 Sub Rosa contributors
// The dashboard empty and error states must never show a sealed bid. These
// tests drive the real hook and the real state components with an injected
// fetch and fake time -- no wallet, RPC or contract client is involved.
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createFakeTime } from "@sub-rosa/time";
import { StatusApiError, StatusJsonParseError, type SdkErrorCode } from "@sub-rosa/sdk";

import { DASHBOARD_FIXTURE } from "../../dashboard/fixture";
import type { DashboardData } from "../../dashboard/types";
import {
  loadDashboardData,
  useDashboardData,
  type UseDashboardDataResult,
} from "../../hooks/useDashboardData";
import { TimeProvider } from "../../lib/time";
import { DashboardContent } from "./DashboardContent";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { DashboardErrorState } from "./DashboardErrorState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ENDPOINT = "https://dashboard.invalid/round";
const POLL_INTERVAL_MS = 30_000;
const NOW_ISO = "2026-06-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

const SEALED_BIDDER = "GSEALEDBIDDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ";
const SEALED_LABEL = "agent-sealed";
const SEALED_BLOB = "c0ffee5ea1edb10bc0ffee5ea1edb10b";

// A round the contract still treats as sealed: commit phase, nothing revealed.
// The extra `ciphertext` field stands in for sealed blob bytes in the payload.
const SEALED_FIXTURE: DashboardData = {
  ...DASHBOARD_FIXTURE,
  meta: { ...DASHBOARD_FIXTURE.meta, fetchedAt: NOW_ISO },
  round: { ...DASHBOARD_FIXTURE.round, status: "Open", winner: null, winningBid: null },
  keeper: {
    currentPhase: "awaiting-drand",
    nextAction: "wait for Drand",
    lastActionAt: null,
    actionHistory: [],
  },
  bidders: [
    {
      address: SEALED_BIDDER,
      label: SEALED_LABEL,
      committed: true,
      revealed: false,
      valid: null,
      settled: false,
      escrowUsdc: 9045,
      bidUsdc: 7310.25,
      ciphertext: SEALED_BLOB,
    } as DashboardData["bidders"][number],
  ],
  settlement: null,
};

// What the round cards display for this bid: amount, escrow and bidder.
const DISPLAYED_MARKERS: RegExp[] = [
  /7[,.\s]?310/,
  /9[,.\s]?045/,
  /GSEALE/,
  new RegExp(SEALED_BIDDER.slice(-6)),
  new RegExp(SEALED_LABEL),
  /USDC/,
];
// Plus the sealed blob bytes, which no dashboard state should ever show.
const SEALED_MARKERS: RegExp[] = [...DISPLAYED_MARKERS, /c0ffee/i];

function assertNoSealedData(rendered: string, context: string) {
  for (const marker of SEALED_MARKERS) {
    assert.doesNotMatch(rendered, marker, `${context}: must not render ${marker}`);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A 200 response whose body delivers part of the sealed payload, then dies. */
function interruptedResponse(): Response {
  const partial = JSON.stringify(SEALED_FIXTURE).slice(0, -40);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(partial));
        controller.error(new Error("connection reset"));
      },
    }),
    { status: 200 },
  );
}

/** A complete, parseable payload that carries the sealed bid but is missing a section. */
function incompleteSealedPayload(): unknown {
  const { keeper: _keeper, ...rest } = SEALED_FIXTURE;
  return rest;
}

type Responder = () => Promise<Response>;

async function mount(initial: Responder) {
  const time = createFakeTime(NOW_MS);
  let responder = initial;
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return responder();
  }) as typeof fetch;

  let result!: UseDashboardDataResult;
  let renderer!: ReactTestRenderer;
  function Harness() {
    result = useDashboardData({ endpoint: ENDPOINT, fetchImpl });
    return <DashboardContent state={result} onRetry={result.refetch} />;
  }
  await act(async () => {
    renderer = create(
      <TimeProvider value={time}>
        <Harness />
      </TimeProvider>,
    );
  });

  return {
    // Methods rather than getters, so an assertion on one read does not
    // narrow the type of the next.
    result: () => result,
    status: () => result.status,
    errorCode: () => (result.status === "error" ? result.code : null),
    get calls() {
      return calls;
    },
    /** The full rendered tree, including every prop and attribute. */
    rendered: () => JSON.stringify(renderer.toJSON()),
    respondWith: (next: Responder) => {
      responder = next;
    },
    poll: () => act(async () => time.scheduler.advance(POLL_INTERVAL_MS)),
    // Starts a load without waiting for it, so a test can hold it in flight.
    refetch: () =>
      act(async () => {
        result.refetch();
      }),
    unmount: () => act(async () => renderer.unmount()),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

test("the sealed fixture markers are detectable when the round is rendered", async () => {
  const h = await mount(async () => jsonResponse(SEALED_FIXTURE));
  try {
    assert.equal(h.status(), "ready");
    for (const marker of DISPLAYED_MARKERS) {
      assert.match(h.rendered(), marker, `ready state should render ${marker}`);
    }
  } finally {
    await h.unmount();
  }
});

test("empty state component renders no amount and accepts no round", () => {
  const html = renderToStaticMarkup(<DashboardEmptyState />);
  assert.match(html, /No Round Data Available/);
  assertNoSealedData(html, "empty state");
  const text = html.replace(/<[^>]*>/g, " ");
  assert.doesNotMatch(text, /\d/, "empty state copy contains no figures at all");
});

test("error state component renders the SDK error code and nothing else from the load", () => {
  const html = renderToStaticMarkup(
    <DashboardErrorState code="STATUS_API_ERROR" onRetry={() => {}} />,
  );
  assert.match(html, /Failed to Load Dashboard/);
  assert.match(html, /<code>STATUS_API_ERROR<\/code>/);
  assertNoSealedData(html, "error state");
});

test("error state component refuses free text passed as a code", () => {
  const smuggled = `bid 7310.25 USDC from ${SEALED_BIDDER}` as unknown as SdkErrorCode;
  const html = renderToStaticMarkup(<DashboardErrorState code={smuggled} onRetry={() => {}} />);
  assert.match(html, /<code>UNKNOWN<\/code>/);
  assertNoSealedData(html, "error state with untyped code");
});

test("loadDashboardData resolves null only for an explicit no-round response", async () => {
  assert.equal(await loadDashboardData(ENDPOINT, async () => jsonResponse(null)), null);
  assert.equal(
    await loadDashboardData(ENDPOINT, async () => jsonResponse({ ...SEALED_FIXTURE, round: null })),
    null,
  );
  assert.deepEqual(
    await loadDashboardData(ENDPOINT, async () => jsonResponse(SEALED_FIXTURE)),
    JSON.parse(JSON.stringify(SEALED_FIXTURE)),
  );
});

test("loadDashboardData throws SDK errors and never returns a partial round", async () => {
  await assert.rejects(
    loadDashboardData(ENDPOINT, async () => jsonResponse(SEALED_FIXTURE, 503)),
    StatusApiError,
  );
  await assert.rejects(
    loadDashboardData(ENDPOINT, async () => interruptedResponse()),
    StatusJsonParseError,
  );
  await assert.rejects(
    loadDashboardData(ENDPOINT, async () => jsonResponse(incompleteSealedPayload())),
    StatusJsonParseError,
  );
  // A payload with no `round` key at all is malformed, not "no round".
  await assert.rejects(
    loadDashboardData(ENDPOINT, async () => jsonResponse({ bidders: SEALED_FIXTURE.bidders })),
    StatusJsonParseError,
  );
});

test("an empty fixture shows the empty state and no amount", async () => {
  const h = await mount(async () => jsonResponse(null));
  try {
    assert.equal(h.status(), "empty");
    assert.equal("data" in h.result(), false);
    assert.match(h.rendered(), /No Round Data Available/);
    assert.doesNotMatch(h.rendered(), /Failed to Load Dashboard/);
    assertNoSealedData(h.rendered(), "empty state");
  } finally {
    await h.unmount();
  }
});

test("a no-round response carrying leftover bidders still shows only the empty state", async () => {
  const h = await mount(async () => jsonResponse({ ...SEALED_FIXTURE, round: null }));
  try {
    assert.equal(h.status(), "empty");
    assert.equal("data" in h.result(), false);
    assertNoSealedData(h.rendered(), "empty state with leftover bidders");
  } finally {
    await h.unmount();
  }
});

test("a failed fixture shows the SDK error code and no bid amount", async () => {
  const h = await mount(async () => jsonResponse(SEALED_FIXTURE, 503));
  try {
    assert.equal(h.errorCode(), "STATUS_API_ERROR");
    assert.equal("data" in h.result(), false);
    assert.match(h.rendered(), /Failed to Load Dashboard/);
    assert.match(h.rendered(), /STATUS_API_ERROR/);
    assert.doesNotMatch(h.rendered(), /No Round Data Available/);
    assertNoSealedData(h.rendered(), "error state");
  } finally {
    await h.unmount();
  }
});

test("a rejected fetch shows the UNKNOWN code, not the rejection text", async () => {
  const h = await mount(async () => {
    throw new TypeError(`fetch failed for bid 7310.25 USDC by ${SEALED_BIDDER}`);
  });
  try {
    assert.equal(h.errorCode(), "UNKNOWN");
    assert.match(h.rendered(), /UNKNOWN/);
    assertNoSealedData(h.rendered(), "error state after rejected fetch");
  } finally {
    await h.unmount();
  }
});

for (const [name, respond] of [
  ["the connection drops mid-body", async () => interruptedResponse()],
  ["the payload arrives incomplete", async () => jsonResponse(incompleteSealedPayload())],
] as Array<[string, Responder]>) {
  test(`a sealed fixture that fails mid-load does not show the fixture amount (${name})`, async () => {
    const h = await mount(respond);
    try {
      assert.equal(h.errorCode(), "STATUS_INVALID_RESPONSE");
      assert.equal("data" in h.result(), false);
      assert.match(h.rendered(), /STATUS_INVALID_RESPONSE/);
      assertNoSealedData(h.rendered(), "error state on first load");
    } finally {
      await h.unmount();
    }
  });

  test(`a loaded sealed round is dropped when a later load fails (${name})`, async () => {
    const h = await mount(async () => jsonResponse(SEALED_FIXTURE));
    try {
      assert.equal(h.status(), "ready");

      h.respondWith(respond);
      await h.poll();

      assert.equal(h.status(), "error");
      assert.equal("data" in h.result(), false, "the earlier round is not kept beside the error");
      assert.match(h.rendered(), /STATUS_INVALID_RESPONSE/);
      assertNoSealedData(h.rendered(), "error state after a loaded round");
    } finally {
      await h.unmount();
    }
  });
}

test("retrying from the error state does not bring the earlier round back while loading", async () => {
  const h = await mount(async () => jsonResponse(SEALED_FIXTURE));
  try {
    h.respondWith(async () => jsonResponse(null, 500));
    await h.poll();
    assert.equal(h.status(), "error");

    const slow = deferred<Response>();
    h.respondWith(() => slow.promise);
    await h.refetch();

    assert.equal(h.status(), "loading");
    assert.equal(h.result().refreshing, true);
    assertNoSealedData(h.rendered(), "loading state after an error");

    await act(async () => slow.resolve(jsonResponse(null, 500)));
    assert.equal(h.status(), "error");
    assertNoSealedData(h.rendered(), "error state after a failed retry");
  } finally {
    await h.unmount();
  }
});

test("a later successful load replaces the error state", async () => {
  const h = await mount(async () => jsonResponse(null, 503));
  try {
    assert.equal(h.status(), "error");

    h.respondWith(async () => jsonResponse(DASHBOARD_FIXTURE));
    await h.poll();

    assert.equal(h.status(), "ready");
    assert.equal("code" in h.result(), false, "the error code is cleared");
    assert.equal(h.result().refreshing, false);
    assert.doesNotMatch(h.rendered(), /Failed to Load Dashboard/);
    assert.doesNotMatch(h.rendered(), /STATUS_API_ERROR/);
    assert.match(h.rendered(), /agent-alpha/);

    h.respondWith(async () => jsonResponse(null));
    await h.poll();
    assert.equal(h.status(), "empty");
    assert.doesNotMatch(h.rendered(), /agent-alpha/);
  } finally {
    await h.unmount();
  }
});

test("a slow failure cannot overwrite a newer successful load", async () => {
  const slowFailure = deferred<Response>();
  const h = await mount(() => slowFailure.promise);
  try {
    assert.equal(h.status(), "loading");

    h.respondWith(async () => jsonResponse(DASHBOARD_FIXTURE));
    await h.refetch();
    assert.equal(h.status(), "ready");

    await act(async () => slowFailure.resolve(jsonResponse(null, 500)));
    assert.equal(h.status(), "ready");
    assert.equal(h.result().refreshing, false);
    assert.doesNotMatch(h.rendered(), /Failed to Load Dashboard/);
  } finally {
    await h.unmount();
  }
});

test("a slow sealed response cannot resurface over a newer failure", async () => {
  const slowSealed = deferred<Response>();
  const h = await mount(() => slowSealed.promise);
  try {
    h.respondWith(async () => jsonResponse(null, 500));
    await h.refetch();
    assert.equal(h.status(), "error");

    await act(async () => slowSealed.resolve(jsonResponse(SEALED_FIXTURE)));
    assert.equal(h.status(), "error");
    assert.equal("data" in h.result(), false);
    assertNoSealedData(h.rendered(), "error state after a superseded sealed response");
    assert.equal(h.calls, 2);
  } finally {
    await h.unmount();
  }
});
