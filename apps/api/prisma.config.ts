// Prisma 7 CLI configuration (migrations, generate). The runtime client gets its connection from the driver adapter.
// Prisma no longer loads .env files by itself: dotenv does it for local use; in Docker the variables are already set.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
