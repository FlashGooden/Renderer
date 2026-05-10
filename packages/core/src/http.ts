import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonRequest<T = any>(request: IncomingMessage): Promise<T> {
  const body = await readRequestBuffer(request);
  return (body.length ? JSON.parse(body.toString("utf8")) : {}) as T;
}

export async function readRequestBuffer(request: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function sendText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(text);
}
