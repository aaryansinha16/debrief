import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { type PolicyBody, ReconstructionService } from './reconstruction.service.js';

const graphQuerySchema = z.object({
  policy: z.string().min(1).default('prod-guard'),
  seed: z.string().min(1).max(64).optional(),
});
const nodeQuerySchema = z.object({
  node: z.string().min(1),
  weak: z.enum(['true', 'false']).default('false'),
});
const policyBodySchema = z
  .object({ policyId: z.string().min(1).optional(), policy: z.string().min(1).optional() })
  .strict();

const parse = <T>(schema: z.ZodType<T>, value: unknown, hint: string): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(hint);
  return parsed.data;
};

@Controller('v1/runs/:id')
export class ReconstructionController {
  constructor(private readonly reconstruction: ReconstructionService) {}

  @Get('graph')
  graph(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { policy, seed } = parse(
      graphQuerySchema,
      query,
      'policy is a sample id, seed ≤ 64 chars',
    );
    return this.reconstruction.graph(request.auth.tenantId, id, policy, seed);
  }

  @Get('blast')
  blast(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { node, weak } = parse(nodeQuerySchema, query, 'node is required; weak is true or false');
    return this.reconstruction.blast(request.auth.tenantId, id, node, weak === 'true');
  }

  @Get('lineage')
  lineage(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { node } = parse(nodeQuerySchema, query, 'node is required');
    return this.reconstruction.lineage(request.auth.tenantId, id, node);
  }

  @Post('divergence')
  @HttpCode(200)
  divergence(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed: PolicyBody = parse(
      policyBodySchema,
      body ?? {},
      'body is { policyId } or { policy }',
    );
    return this.reconstruction.divergence(request.auth.tenantId, id, parsed);
  }

  @Post('counterfactual')
  @HttpCode(200)
  counterfactual(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed: PolicyBody = parse(
      policyBodySchema,
      body ?? {},
      'body is { policyId } or { policy }',
    );
    return this.reconstruction.counterfactual(request.auth.tenantId, id, parsed);
  }
}
