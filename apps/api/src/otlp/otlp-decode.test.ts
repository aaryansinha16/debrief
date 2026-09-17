import { otelFixtureSpans } from '@debrief/schema/fixtures';
import { describe, expect, it } from 'vitest';

import {
  OtlpDecodeError,
  decodeJsonTraces,
  decodeProtobufTraces,
  toOtelSpans,
} from './otlp-decode.js';
import { toOtlpJson, toProtobufObject } from './otlp-json.js';
import { ExportTraceServiceRequest } from './otlp-proto.js';

const spans = otelFixtureSpans();
const json = toOtlpJson(spans);

describe('OTLP decoding', () => {
  it('round-trips the fixture through OTLP/JSON', () => {
    expect(decodeJsonTraces(json)).toEqual(spans);
  });

  it('round-trips the fixture through OTLP protobuf', () => {
    const message = ExportTraceServiceRequest.fromObject(toProtobufObject(json));
    const bytes = ExportTraceServiceRequest.encode(message).finish();
    expect(decodeProtobufTraces(bytes)).toEqual(spans);
  });

  it('accepts enum names, base64 ids, numeric times and every value type', () => {
    const decoded = toOtelSpans({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'svc' } },
              {
                key: 'nested',
                value: { kvlistValue: { values: [{ key: 'a', value: { intValue: 1 } }] } },
              },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: Buffer.from('4bf92f3577b34da6a3ce929d0e0e4736', 'hex').toString(
                    'base64',
                  ),
                  spanId: Buffer.from('00f067aa0ba902b7', 'hex').toString('base64'),
                  parentSpanId: '',
                  name: 'x',
                  kind: 'SPAN_KIND_SERVER',
                  startTimeUnixNano: 1700000000000000000,
                  endTimeUnixNano: '1700000000000000001',
                  attributes: [
                    { key: 'big', value: { intValue: '9223372036854775807' } },
                    { key: 'small', value: { intValue: '42' } },
                    { key: 'dbl', value: { doubleValue: 1.5 } },
                    { key: 'bytes', value: { bytesValue: 'AQID' } },
                    {
                      key: 'mixed',
                      value: {
                        arrayValue: {
                          values: [
                            { stringValue: 'a' },
                            { intValue: '2' },
                            { arrayValue: { values: [{ boolValue: true }] } },
                          ],
                        },
                      },
                    },
                    { key: 'empty', value: {} },
                    { key: 'novalue' },
                  ],
                  status: { code: 'STATUS_CODE_ERROR', message: '' },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(decoded).toEqual([
      {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        name: 'x',
        kind: 'server',
        startUnixNano: '1700000000000000000',
        endUnixNano: '1700000000000000001',
        attributes: {
          big: '9223372036854775807',
          small: 42,
          dbl: 1.5,
          bytes: 'AQID',
          mixed: ['a', 2, '[true]'],
        },
        resource: { 'service.name': 'svc', nested: '{"a":1}' },
        status: { code: 'error' },
      },
    ]);
  });

  it('tolerates unknown kinds and codes and missing sections', () => {
    expect(toOtelSpans({})).toEqual([]);
    expect(toOtelSpans({ resourceSpans: [{ scopeSpans: [] }] })).toEqual([]);
    const [span] = toOtelSpans({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'a'.repeat(32),
                  spanId: 'b'.repeat(16),
                  kind: 99,
                  status: { code: 'weird' },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(span).toMatchObject({
      kind: 'unspecified',
      status: { code: 'unset' },
      name: '',
      attributes: {},
    });
  });

  it.each([
    ['not an object', 'nope'],
    [
      'bad trace id',
      { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'zz', spanId: 'b'.repeat(16) }] }] }] },
    ],
    [
      'short base64 id',
      {
        resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'AQID', spanId: 'b'.repeat(16) }] }] }],
      },
    ],
    [
      'missing span id',
      { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'a'.repeat(32) }] }] }] },
    ],
    [
      'bad time',
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), startTimeUnixNano: 'soon' },
                ],
              },
            ],
          },
        ],
      },
    ],
  ])('rejects %s', (_label, body) => {
    expect(() => decodeJsonTraces(body)).toThrow(OtlpDecodeError);
  });

  it('rejects malformed protobuf', () => {
    expect(() => decodeProtobufTraces(new Uint8Array([0xff, 0xff, 0xff]))).toThrow(OtlpDecodeError);
  });
});
