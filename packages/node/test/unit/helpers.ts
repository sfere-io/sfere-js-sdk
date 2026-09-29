import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: { batch: Record<string, unknown>[]; writeKey?: string; sentAt?: string };
}

export interface MockIngest {
  origin: string;
  received: Received[];
  /** Status codes to answer with, in order; 200 once exhausted. */
  respond: number[];
  close(): Promise<void>;
}

/** A local ingestion endpoint that records every request and answers `{"ok":true}`. */
export async function mockIngest(): Promise<MockIngest> {
  const received: Received[] = [];
  const respond: number[] = [];
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: JSON.parse(data || "{}") });
      const status = respond.shift() ?? 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(status === 200 ? '{"ok":true}' : '{"error":"mock"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    respond,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Every event across every batch the mock received. */
export const events = (mock: MockIngest): Record<string, unknown>[] =>
  mock.received.flatMap((request) => request.body.batch);
