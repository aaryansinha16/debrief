// D-079 (amended): web fixtures may name a real system as a label, never its API, field or event names or id prefixes.
export const VENDOR_TERMS =
  /\b(?:anthropic|claude|livemode|webhookEndpoints|webhook_endpoint|workflow_run|check_run|pull_request|actions\/runs|deployment\.(?:created|ready|error|promoted))\b|\b(?:toolu|we|req|dpl|evt|sk|pk)_\w/i;

export const VENDOR_NAMES = /\b(?:github|neon|vercel|stripe|aws|cloudtrail)\b/i;

// A system's own name, a witness's daily run (ARCHITECTURE §18.6) or the witness itself may carry a vendor's name.
const SYSTEM_SHAPED = /^(?:witness:[a-z-]+:\d{4}-\d{2}-\d{2}|[a-z-]+-witness)$/;

// Every key and string in a fixture that breaks the rule; a vendor's name may only name a system or its witness.
export function realNameLeaks(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    const named = key === 'system' || SYSTEM_SHAPED.test(value);
    const leak = VENDOR_TERMS.test(value) || (!named && VENDOR_NAMES.test(value));
    return leak ? [`${key}: ${value}`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => realNameLeaks(item, key));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, inner]) => [
    ...(VENDOR_TERMS.test(name) || VENDOR_NAMES.test(name) ? [`key ${name}`] : []),
    ...realNameLeaks(inner, name),
  ]);
}
