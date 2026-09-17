import { LineCounter, type Document, parseDocument } from 'yaml';

import { type Policy, policySchema } from './policy.js';

export interface PolicyIssue {
  line: number;
  column: number;
  message: string;
}

export class PolicyParseError extends Error {
  override readonly name = 'PolicyParseError';

  constructor(readonly issues: readonly PolicyIssue[]) {
    super(
      issues
        .map((issue) => `${String(issue.line)}:${String(issue.column)} ${issue.message}`)
        .join('\n'),
    );
  }
}

function positionOf(
  doc: Document,
  counter: LineCounter,
  path: readonly PropertyKey[],
): { line: number; column: number } {
  for (let depth = path.length; depth >= 0; depth -= 1) {
    const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
    const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
    if (range !== undefined) {
      const pos = counter.linePos(range[0]);
      return { line: pos.line, column: pos.col };
    }
  }
  return { line: 1, column: 1 };
}

export function parsePolicy(text: string): Policy {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false });
  const issues: PolicyIssue[] = doc.errors.map((error) => {
    const pos = counter.linePos(error.pos[0]);
    return { line: pos.line, column: pos.col, message: error.message };
  });
  if (issues.length > 0) throw new PolicyParseError(issues);
  const parsed = policySchema.safeParse(doc.toJS() as unknown);
  if (parsed.success) return parsed.data;
  throw new PolicyParseError(
    parsed.error.issues.map((issue) => ({
      ...positionOf(doc, counter, issue.path),
      message: `${issue.path.map(String).join('.') || 'policy'}: ${issue.message}`,
    })),
  );
}
