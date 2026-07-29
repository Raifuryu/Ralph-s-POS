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

`docker-compose.yml` only containerizes the **app** — it connects out to a MariaDB instance you already have running (not a container Compose manages). `.env.local` is the single source of truth for both `pnpm dev` and Docker (`env_file: .env.local`); the only override is `MARIADB_HOST`, forced to `host.docker.internal` (Docker's special DNS name for reaching the host machine) since `127.0.0.1` inside a container means the container itself, not your host. If your MariaDB instance actually lives on a different machine, change that override in `docker-compose.yml` to its real hostname/IP instead.

1. **Apply the schema + seed data** to your existing MariaDB instance, if you haven't already (same commands as local dev above):
   ```bash
   mariadb -h $MARIADB_HOST -P $MARIADB_PORT -u $MARIADB_USER -p $MARIADB_DATABASE < mariadb/schema.sql
   mariadb -h $MARIADB_HOST -P $MARIADB_PORT -u $MARIADB_USER -p $MARIADB_DATABASE < mariadb/seed-data.sql   # optional
   ```
2. **Make sure MariaDB actually accepts connections from the container**, not just `localhost` — this is the most common thing to trip on here:
   - `bind-address` in your MariaDB config (`my.cnf`) needs to allow more than `127.0.0.1` (e.g. `0.0.0.0`, or scoped to the Docker bridge subnet).
   - Your `MARIADB_USER` account's grant needs a host that covers Docker's bridge network, not just `'user'@'localhost'` — e.g. `'user'@'%'`, or run `GRANT ALL ON ralph_pos.* TO 'user'@'%' IDENTIFIED BY '...';` for that user.
   - A local firewall (e.g. `ufw`) needs to allow the `MARIADB_PORT` from Docker's bridge subnet.
3. **Fill in `.env.local`** (copy `.env.local.example` if you don't have one yet) — same vars as local dev.
4. **Build and start**:
   ```bash
   docker compose up -d --build
   ```
5. **Create your login**, via the `tools` service (a separate, on-demand image — see below):
   ```bash
   docker compose --profile tools run --rm tools seed-user <username> <password>
   ```
6. Visit `http://localhost:2999` and sign in.

`app` (what `docker compose up` actually runs) is Next's `output: "standalone"` build — a pruned `node_modules` with no `pnpm`/devDependencies, started via `node server.js` rather than `pnpm start`. That's deliberate: running `pnpm start` in a container hits pnpm's own pre-flight lockfile check, which can misfire on a `node_modules` copied in from an earlier build stage (no TTY to confirm the reinstall it wants to do) and crash-loop. `tools` builds only as far as the `builder` stage, which still has the full `node_modules` (including `tsx`), so `pnpm seed-user`/`pnpm db-query` work the same as local dev — but it's gated behind a Compose profile so it never starts on its own:
```bash
docker compose --profile tools run --rm tools db-query "SELECT COUNT(*) FROM products"
```

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
