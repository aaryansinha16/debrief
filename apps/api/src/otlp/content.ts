import { ATTR, redactText } from '@debrief/schema';

const SNIPPET_LENGTH = 120;
const TEXT_KEYS = ['content', 'text', 'value', 'parts', 'message', 'messages', 'choices'] as const;
const LABEL_KEYS: ReadonlySet<string> = new Set([
  'role',
  'type',
  'name',
  'id',
  'finish_reason',
  'model',
]);

function firstText(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (texts.length > 0) return;
      if (typeof node === 'string') {
        if (node.trim() !== '') texts.push(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (node !== null && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        for (const key of TEXT_KEYS) if (key in record) walk(record[key]);
        if (texts.length === 0) {
          for (const [key, item] of Object.entries(record)) if (!LABEL_KEYS.has(key)) walk(item);
        }
      }
    };
    walk(parsed);
    return texts[0];
  } catch {
    return value;
  }
}

const SNIPPET_SOURCES = [
  ATTR.outputMessages,
  ATTR.toolCallResult,
  ATTR.inputMessages,
  ATTR.toolCallArguments,
  ATTR.systemInstructions,
] as const;

// A one-line, redacted, length-capped quote from the content; safe to show in every scene.
export function deriveSnippet(content: Record<string, string>, salt: string): string | undefined {
  const sources = [...SNIPPET_SOURCES, ...Object.keys(content)];
  for (const source of sources) {
    const raw = content[source];
    if (raw === undefined) continue;
    const flat = (firstText(raw) ?? '').replace(/\s+/g, ' ').trim();
    if (flat === '') continue;
    const clipped = flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH - 1)}…` : flat;
    return redactText(clipped, { salt, maxTextLength: SNIPPET_LENGTH }).text;
  }
  return undefined;
}

export function summaryWithSnippet(
  summary: string | undefined,
  snippet: string | undefined,
): string | undefined {
  if (snippet === undefined) return summary;
  const joined = summary === undefined ? `“${snippet}”` : `${summary} · “${snippet}”`;
  return joined.length <= 280 ? joined : `${joined.slice(0, 279)}…`;
}
