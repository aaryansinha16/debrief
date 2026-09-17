import { describe, expect, it } from 'vitest';

import { deriveSnippet, redactedContentDocument, summaryWithSnippet } from './content.js';

const salt = 's';

describe('deriveSnippet', () => {
  it('prefers output over input and quotes the first text part of structured messages', () => {
    const content = {
      'gen_ai.input.messages':
        '[{"role":"user","parts":[{"type":"text","content":"why does staging fail?"}]}]',
      'gen_ai.output.messages':
        '[{"role":"assistant","parts":[{"type":"text","content":"  Deleting  vol-prod-01 "}]}]',
    };
    expect(deriveSnippet(content, salt)).toBe('Deleting vol-prod-01');
    const { 'gen_ai.output.messages': _out, ...inputOnly } = content;
    expect(deriveSnippet(inputOnly, salt)).toBe('why does staging fail?');
    const toolCallOnly = {
      ...inputOnly,
      'gen_ai.output.messages':
        '[{"role":"assistant","parts":[{"type":"tool_call","name":"readFile"}]}]',
    };
    expect(deriveSnippet(toolCallOnly, salt)).toBe('why does staging fail?');
  });

  it('handles raw strings, unknown keys, empties and redacts', () => {
    expect(
      deriveSnippet({ 'gen_ai.tool.call.result': 'ORBITAL_TOKEN=orb_live_9f3aQ7xLm2 ok' }, salt),
    ).toMatch(/^ORBITAL_TOKEN=\[secret:[0-9a-f]{8}\] ok$/);
    expect(deriveSnippet({ 'retrieval.documents.0.document.content': 'doc text' }, salt)).toBe(
      'doc text',
    );
    expect(deriveSnippet({}, salt)).toBeUndefined();
    expect(deriveSnippet({ 'gen_ai.input.messages': '   ' }, salt)).toBeUndefined();
    expect(deriveSnippet({ 'gen_ai.input.messages': '[]' }, salt)).toBeUndefined();
    expect(
      deriveSnippet(
        { 'gen_ai.input.messages': '{"role":"user","content":{"nested":["deep"]}}' },
        salt,
      ),
    ).toBe('deep');
    expect(deriveSnippet({ 'gen_ai.input.messages': '{"a":1,"b":null}' }, salt)).toBeUndefined();
  });

  it('caps the snippet length', () => {
    const snippet = deriveSnippet({ 'gen_ai.input.messages': 'x'.repeat(500) }, salt);
    expect(snippet).toHaveLength(120);
    expect(snippet!.endsWith('…')).toBe(true);
  });
});

describe('summaryWithSnippet', () => {
  it('joins and caps at 280', () => {
    expect(summaryWithSnippet('chat atlas-4', 'hello')).toBe('chat atlas-4 · “hello”');
    expect(summaryWithSnippet(undefined, 'hello')).toBe('“hello”');
    expect(summaryWithSnippet('chat', undefined)).toBe('chat');
    expect(summaryWithSnippet('x'.repeat(270), 'y'.repeat(50))).toHaveLength(280);
  });
});

describe('redactedContentDocument', () => {
  it('serializes redacted content with the source id, or nothing without content', () => {
    const doc = redactedContentDocument(
      {
        sourceId: 't:s',
        input: {} as never,
        content: { 'gen_ai.tool.call.result': 'ORBITAL_TOKEN=orb_live_9f3aQ7xLm2' },
      },
      salt,
    );
    const parsed = JSON.parse(new TextDecoder().decode(doc)) as {
      sourceId: string;
      content: Record<string, string>;
    };
    expect(parsed.sourceId).toBe('t:s');
    expect(parsed.content['gen_ai.tool.call.result']).toMatch(
      /^ORBITAL_TOKEN=\[secret:[0-9a-f]{8}\]$/,
    );
    expect(redactedContentDocument({ sourceId: 't:s', input: {} as never }, salt)).toBeUndefined();
  });
});
