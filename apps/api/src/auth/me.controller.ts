import { Controller, Get, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from './api-key.guard.js';
import type { ResolvedKey } from './api-keys.repository.js';

@Controller('v1')
export class MeController {
  @Get('me')
  me(@Req() request: AuthenticatedRequest): ResolvedKey {
    return request.auth;
  }
}
