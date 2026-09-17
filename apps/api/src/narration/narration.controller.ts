import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/api-key.guard.js';
import { NarrationService } from './narration.service.js';

// ARCHITECTURE §13: POST /v1/runs/:id/narrative is opt-in and cached; nothing else in the API talks to a model.
@Controller('v1/runs/:id')
export class NarrationController {
  constructor(private readonly narration: NarrationService) {}

  @Post('narrative')
  @HttpCode(200)
  narrative(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.narration.narrate(request.auth.tenantId, id);
  }
}
