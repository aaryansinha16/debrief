import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { RateBucketOf } from '../rate-limit/rate-bucket.decorator.js';
import { OtlpDecodeError, decodeJsonTraces, decodeProtobufTraces } from './otlp-decode.js';
import { ExportTraceServiceResponse } from './otlp-proto.js';
import { OtlpService } from './otlp.service.js';

export const PROTOBUF = 'application/x-protobuf';

interface ExportResponse {
  partialSuccess?: { rejectedSpans: number; errorMessage: string };
}

@Controller('v1')
@RateBucketOf('ingest')
export class TracesController {
  constructor(private readonly otlp: OtlpService) {}

  @Post('traces')
  @HttpCode(200)
  async traces(
    @Req() request: AuthenticatedRequest,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportResponse | Buffer> {
    const isProtobuf = contentType?.startsWith(PROTOBUF) ?? false;
    let spans;
    try {
      spans = isProtobuf ? decodeProtobufTraces(body as Uint8Array) : decodeJsonTraces(body);
    } catch (error) {
      if (error instanceof OtlpDecodeError) throw new BadRequestException(error.message);
      throw error;
    }
    const summary = await this.otlp.ingest(request.auth.tenantId, request.auth.captureMode, spans);
    const response: ExportResponse =
      summary.ignored === 0
        ? {}
        : {
            partialSuccess: {
              rejectedSpans: 0,
              errorMessage: `ignored ${String(summary.ignored)} span(s) without a gen_ai or mcp operation`,
            },
          };
    if (!isProtobuf) return response;
    void reply.header('content-type', PROTOBUF);
    return Buffer.from(
      ExportTraceServiceResponse.encode(ExportTraceServiceResponse.fromObject(response)).finish(),
    );
  }
}
