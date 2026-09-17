import { describe, expect, it } from 'vitest';

import {
  LineBuffer,
  idKey,
  isNotification,
  isRequest,
  isResponse,
  parseMessage,
} from './jsonrpc.js';

describe('LineBuffer', () => {
  it('splits on newlines across chunks and flushes the tail', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(buffer.push(':2}\r\n\n')).toEqual(['{"b":2}']);
    expect(buffer.push('{"c":3}')).toEqual([]);
    expect(buffer.flush()).toEqual(['{"c":3}']);
    expect(buffer.flush()).toEqual([]);
  });
});

describe('parseMessage', () => {
  it('accepts json-rpc shapes and rejects the rest', () => {
    const request = parseMessage(
      '{"jsonrpc":"2.0","id":1,"method":"ping","params":{},"extra":true}',
    )!;
    expect(isRequest(request)).toBe(true);
    expect(isNotification(request)).toBe(false);
    expect(isResponse(request)).toBe(false);
    expect(request).toMatchObject({ extra: true });
    expect(isNotification(parseMessage('{"jsonrpc":"2.0","method":"notifications/x"}')!)).toBe(
      true,
    );
    expect(isResponse(parseMessage('{"jsonrpc":"2.0","id":"a","result":null}')!)).toBe(true);
    expect(parseMessage('not json')).toBeUndefined();
    expect(parseMessage('{"jsonrpc":"1.0","id":1}')).toBeUndefined();
    expect(parseMessage('{"jsonrpc":"2.0","id":1,"error":{"code":"x"}}')).toBeUndefined();
    expect(idKey(1)).toBe('number:1');
    expect(idKey('1')).toBe('string:1');
  });
});
