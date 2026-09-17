import { runMigrations } from './migrate.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (adminUrl === undefined) {
  process.stderr.write('DATABASE_ADMIN_URL is required\n');
  process.exit(2);
}
await runMigrations({ adminUrl, appRole: process.env.APP_DB_USER ?? 'debrief_app' });
process.stdout.write('migrations applied\n');
