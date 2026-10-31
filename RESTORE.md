# Restore TABLE21 from a checkpoint

Each checkpoint has three files: `table21-<label>-<sha>.tar.gz` (source), `.bundle` (git history) and `.json` (SHA-256 and commit).

## 1. Verify the download

```bash
shasum -a 256 table21-*.tar.gz   # compare with "archive.sha256" in the .json file
```

## 2. Unpack (pick one)

```bash
# Source only
tar -xzf table21-<label>-<sha>.tar.gz && cd table21

# Or with full git history
git clone table21-<label>-<sha>.bundle table21 && cd table21
```

## 3. Install and run

Requirements: Node.js 22.12+ and pnpm 10 (`npm i -g pnpm@10`). PostgreSQL is optional.

```bash
pnpm install
pnpm build            # builds the web client
pnpm start            # serves game + API on http://127.0.0.1:3021 (embedded database in .data/embedded)
```

With a local PostgreSQL (recommended for development and required for the integration tests):

```bash
node scripts/db.mjs start                         # isolated cluster in .data/pg on port 55432
export DATABASE_URL=postgres://t21@127.0.0.1:55432/table21
pnpm migrate && pnpm start
```

LAN host for phones on the same Wi-Fi: `pnpm lan` (see docs/LAN_SETUP.md).

## 4. Continue development

Read `CLAUDE.md` and `docs/NEXT_STEPS.md` first. Run `pnpm test:unit`, `pnpm test:integration` (needs the local PostgreSQL above) and `pnpm test:e2e`.
