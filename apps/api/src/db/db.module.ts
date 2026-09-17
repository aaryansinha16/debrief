import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { CONFIG, type Config } from '../config/config.js';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export const DB = Symbol('DB');
export const SQL_CLIENT = Symbol('SQL_CLIENT');

export function createSqlClient(url: string): Sql {
  return postgres(url, { max: 10, onnotice: () => undefined });
}

export function createDb(client: Sql): Db {
  return drizzle(client, { schema });
}

@Injectable()
class SqlClientLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SQL_CLIENT) private readonly client: Sql) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SQL_CLIENT,
      useFactory: (config: Config) => createSqlClient(config.DATABASE_URL),
      inject: [CONFIG],
    },
    { provide: DB, useFactory: createDb, inject: [SQL_CLIENT] },
    SqlClientLifecycle,
  ],
  exports: [DB, SQL_CLIENT],
})
export class DbModule {}
