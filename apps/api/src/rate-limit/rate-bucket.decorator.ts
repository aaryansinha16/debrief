import { SetMetadata } from '@nestjs/common';

import type { RateBucket } from './rate-limiter.js';

export const RATE_BUCKET = 'debrief:rate-bucket';

export const RateBucketOf = (bucket: RateBucket): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_BUCKET, bucket);
