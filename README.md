This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local development (MariaDB branch)

This branch runs entirely against a local MariaDB instance via `mysql2` — no Supabase, no hosted database. `main` still runs on Supabase; this setup is local-only.

1. **Point `.env.local` at your MariaDB instance.** Copy `.env.local.example` if you don't have one yet, and fill in `MARIADB_HOST`/`MARIADB_PORT`/`MARIADB_USER`/`MARIADB_PASSWORD`/`MARIADB_DATABASE`. Generate a real `SESSION_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. **Apply the schema**, then optionally the seed data (real production data exported from Supabase, with historical `cashier_id`/`created_by`/`voided_by` remapped to one placeholder `migrated-data` account — see the comment at the top of `mariadb/seed-data.sql`):
   ```bash
   mariadb -h $MARIADB_HOST -P $MARIADB_PORT -u $MARIADB_USER -p $MARIADB_DATABASE < mariadb/schema.sql
   mariadb -h $MARIADB_HOST -P $MARIADB_PORT -u $MARIADB_USER -p $MARIADB_DATABASE < mariadb/seed-data.sql   # optional
   ```
   No local `mariadb`/`mysql` CLI? `pnpm db-query "SELECT COUNT(*) FROM products"` works too, once `.env.local` is set.
3. **Create your login** — there's no signup page (same as before, under Supabase):
   ```bash
   pnpm seed-user <username> <password>
   ```
   Re-running with the same username resets its password.
4. `pnpm dev`, then sign in with the username/password from step 3.

Business logic that used to live in Postgres functions (`checkout`, `record_service`, `void_transaction`, ...) now lives in `lib/mysql/operations/*.ts`, run as `mysql2` transactions with the same row-locking discipline the SQL had. Auth is a minimal signed-cookie session (`lib/auth/session.ts`) — no Row-Level Security exists in MariaDB, so authorization is just "is there a valid session" plus explicit `cashier_id`/`created_by` attribution on every write.

## Running in Docker

`docker-compose.yml` runs the app and a MariaDB container together — no local MariaDB install needed. `mariadb/schema.sql` and `mariadb/seed-data.sql` are mounted into the `db` container and applied automatically on its first boot (the official MariaDB image runs everything in `/docker-entrypoint-initdb.d/` once, when its data volume is empty).

`.env.local` is the single source of truth for both `pnpm dev` and Docker — Compose loads it directly (`env_file: .env.local` in `docker-compose.yml`). The only override is `MARIADB_HOST`, forced to `db` (the Compose service name) inside containers, since `127.0.0.1` wouldn't reach the `db` container from `app`.

1. **Fill in `.env.local`** (copy `.env.local.example` if you don't have one yet) — same steps as local dev above, plus one Docker-only var: `MARIADB_ROOT_PASSWORD`, used to bootstrap the containerized database's root account. If `MARIADB_USER` is `root`, read the caveat in `.env.local.example` — you'll likely want a non-root `MARIADB_USER` instead.
2. **Build and start**:
   ```bash
   docker compose up -d --build
   ```
   First boot takes a bit longer while the `db` container imports the schema + seed data.
3. **Create your login** (same script as local dev, run inside the running `app` container):
   ```bash
   docker compose exec app pnpm seed-user <username> <password>
   ```
4. Visit `http://localhost:3000` and sign in.

To reseed from scratch (e.g. after editing `mariadb/seed-data.sql`), the init scripts only run on an empty data directory: `docker compose down -v` removes the `db_data` volume, then `docker compose up -d --build` re-imports everything. This deletes all data in the containerized database — never run it against a volume holding real data you haven't backed up.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# Ralph-s-POS
