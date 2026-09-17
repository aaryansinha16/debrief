import { z } from 'zod';

export const jsonRpcIdSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export const jsonRpcMessageSchema = z.looseObject({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema.nullable().optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional(),
});

export type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>;

export const isRequest = (m: JsonRpcMessage): boolean =>
  m.method !== undefined && m.id !== undefined && m.id !== null;
export const isNotification = (m: JsonRpcMessage): boolean =>
  m.method !== undefined && (m.id === undefined || m.id === null);
export const isResponse = (m: JsonRpcMessage): boolean =>
  m.method === undefined && m.id !== undefined && m.id !== null;

export const idKey = (id: JsonRpcId): string => `${typeof id}:${String(id)}`;

// MCP stdio framing: one JSON message per line, delimited by \n.
export class LineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    return lines.map((line) => line.replace(/\r$/, '')).filter((line) => line !== '');
  }

  flush(): string[] {
    const rest = this.pending.replace(/\r$/, '');
    this.pending = '';
    return rest === '' ? [] : [rest];
  }
}

export function parseMessage(line: string): JsonRpcMessage | undefined {
  try {
    const parsed = jsonRpcMessageSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
