import { Global, Module } from '@nestjs/common';

import { TenantKeysService } from './tenant-keys.service.js';

@Global()
@Module({
  providers: [TenantKeysService],
  exports: [TenantKeysService],
})
export class TenantsModule {}
