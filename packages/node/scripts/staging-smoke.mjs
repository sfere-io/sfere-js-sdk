// Sends a tagged identify + purchase through the BUILT SDK to a real ingestion host and requires
// the host to accept every event. Run after `npm run build`:
//
//   SFERE_WRITE_KEY=<server key> SFERE_HOST=https://console.fanfinity.io npm run smoke:staging
//
// The key is read from the environment only. Events carry messageIds `sfere-node-smoke-<run>-*`,
// an `sfere_smoke: true` property and documentation-range IPs (198.51.100.x), so they are easy to
// find in the console's incoming-events log and cannot match a real person.
import { SfereAnalytics, requestContext, version } from "../dist/index.js";

const writeKey = process.env.SFERE_WRITE_KEY;
const host = process.env.SFERE_HOST;
if (!writeKey || !host) {
  console.error("staging-smoke: set SFERE_WRITE_KEY and SFERE_HOST");
  process.exit(2);
}

const run = `${Date.now()}`;
const responses = [];
// The real transport, observed: record every response the ingestion host gives.
const observing = {
  async makeRequest(request) {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    responses.push({ status: response.status, body: await response.clone().text() });
    return response;
  },
};

const sfere = new SfereAnalytics({
  writeKey,
  host,
  flushInterval: 100,
  maxRetries: 1,
  httpClient: observing,
});
const errors = [];
sfere.on("error", (error) => errors.push(error));

const context = requestContext(
  new Request(`https://shop.example.com/checkout/thanks?gclid=SMOKE_GCLID&utm_source=smoke`, {
    headers: {
      "x-forwarded-for": "198.51.100.77",
      "user-agent": `SfereNodeSmoke/${version} (run ${run})`,
      cookie: "_fbp=fb.1.1700000000000.SMOKE",
    },
  }),
);
sfere.identify({
  messageId: `sfere-node-smoke-${run}-identify`,
  userId: `smoke-${run}`,
  traits: { sfere_smoke: true },
  context,
});
sfere.track({
  messageId: `sfere-node-smoke-${run}-purchase`,
  userId: `smoke-${run}`,
  event: "purchase",
  properties: { sfere_smoke: true, currency: "SAR", value: 1, transaction_id: `smoke-${run}` },
  context,
});
await sfere.closeAndFlush({ timeout: 20_000 });

const summary = responses.map((r) => `${r.status} ${r.body}`).join("\n  ");
console.log(`staging-smoke: run ${run} -> ${host}\n  ${summary || "(no response)"}`);
const accepted = responses.reduce((sum, r) => {
  try {
    return sum + (r.status === 200 ? (JSON.parse(r.body).okEvents ?? 0) : 0);
  } catch {
    return sum;
  }
}, 0);
if (errors.length || accepted !== 2) {
  console.error(`staging-smoke: FAILED (${accepted}/2 events accepted, ${errors.length} errors)`);
  for (const error of errors) console.error(" ", error?.message ?? error);
  process.exit(1);
}
console.log(`staging-smoke: ok, 2/2 events accepted; messageIds sfere-node-smoke-${run}-*`);
