import { type Context, type Span, SpanKind, type Tracer, context, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

export interface TelemetryOptions {
  apiUrl: string;
  apiKey: string;
  serviceName: string;
}

export interface Telemetry {
  tracer: Tracer;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  traceparentOf(span: Span): string;
}

// Real gen_ai spans exported over OTLP/JSON to Debrief's /v1/traces; flushed after every step so ordering is stable.
export function createTelemetry(options: TelemetryOptions): Telemetry {
  const exporter = new OTLPTraceExporter({
    url: new URL('/v1/traces', options.apiUrl).href,
    headers: { authorization: `Bearer ${options.apiKey}` },
  });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': options.serviceName,
      'service.version': '0.1.0',
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const propagator = new W3CTraceContextPropagator();
  return {
    tracer: provider.getTracer('debrief-sandbox-agent'),
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
    traceparentOf(span) {
      const carrier: Record<string, string> = {};
      propagator.inject(trace.setSpan(context.active(), span), carrier, {
        set: (target: Record<string, string>, key: string, value: string) => {
          target[key] = value;
        },
      });
      return carrier.traceparent ?? '';
    },
  };
}

export const withSpan = <T>(span: Span, fn: () => Promise<T>): Promise<T> =>
  context.with(trace.setSpan(context.active(), span), fn);

export const childOf = (span: Span): Context => trace.setSpan(context.active(), span);

export { SpanKind };
