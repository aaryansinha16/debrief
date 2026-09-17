import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

import type { Config } from '../config/config.js';

export const OBJECT_STORE = Symbol('OBJECT_STORE');

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | undefined>;
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, StoredObject>();

  put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body: Uint8Array.from(body), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | undefined> {
    return Promise.resolve(this.objects.get(key));
  }
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    clientConfig: S3ClientConfig,
  ) {
    this.client = new S3Client(clientConfig);
  }

  static fromConfig(
    config: Pick<
      Config,
      'S3_BUCKET' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'
    >,
  ): S3ObjectStore {
    return new S3ObjectStore(config.S3_BUCKET, {
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<StoredObject | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await result.Body?.transformToByteArray();
      return body === undefined
        ? undefined
        : { body, contentType: result.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (error instanceof NoSuchKey) return undefined;
      throw error;
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
