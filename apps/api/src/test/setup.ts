import { existsSync } from 'node:fs';

const envFile = new URL('../../../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.LOG_LEVEL = 'silent';
process.env.SIGNING_KEY_SECRET ??=
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
process.env.BLOB_MASTER_KEY ??= 'cd'.repeat(32);
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'debrief';
process.env.S3_ACCESS_KEY_ID ??= process.env.MINIO_ROOT_USER ?? 'debrief';
process.env.S3_SECRET_ACCESS_KEY ??= process.env.MINIO_ROOT_PASSWORD ?? 'debrief-local-only';
