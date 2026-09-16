import { CanonicalizeError } from './errors.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

// RFC 8785 (JCS). Undefined object properties are omitted, as JSON.stringify does; undefined anywhere else is an error.
export function canonicalize(value: unknown): string {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value))
        throw new CanonicalizeError(`non-finite number: ${String(value)}`);
      return JSON.stringify(value);
    case 'object':
      if (value === null) return 'null';
      if (Array.isArray(value)) return `[${value.map(canonicalizeElement).join(',')}]`;
      return canonicalizeObject(value);
    default:
      throw new CanonicalizeError(`unsupported value of type ${typeof value}`);
  }
}

function canonicalizeElement(value: unknown): string {
  if (value === undefined) throw new CanonicalizeError('undefined array element');
  return canonicalize(value);
}

function canonicalizeObject(value: object): string {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalizeError('only plain objects can be canonicalized');
  }
  const record = value as Record<string, unknown>;
  // RFC 8785 §3.2.3: property names sorted by UTF-16 code units, which is the default sort order
  const members = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${members.join(',')}}`;
}
