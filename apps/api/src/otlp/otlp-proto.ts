import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import protobuf from 'protobufjs';

const PROTO_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../proto');

function load(): protobuf.Root {
  const root = new protobuf.Root();
  root.resolvePath = (_origin: string, target: string) => join(PROTO_DIR, target);
  root.loadSync('opentelemetry/proto/collector/trace/v1/trace_service.proto');
  return root;
}

const root = load();

export const ExportTraceServiceRequest = root.lookupType(
  'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
);
export const ExportTraceServiceResponse = root.lookupType(
  'opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse',
);
