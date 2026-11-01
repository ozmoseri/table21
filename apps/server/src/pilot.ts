import type { Db } from './db.ts';

/**
 * Free-tier pilot facts for the operator (Oz). Render's free plan (checked 2026-11-01, docs/DEPLOY.md):
 * the free Postgres database expires 30 days after it was created, then is deleted after a further 14-day grace
 * period unless upgraded; the database holds 1 GB; free web services share 750 instance hours per workspace per month.
 */
export const FREE_DB_DAYS = 30;
export const FREE_DB_GRACE_DAYS = 14;
export const FREE_DB_BYTES = 1024 ** 3;
export const FREE_HOURS_PER_MONTH = 750;
const DAY = 24 * 3600 * 1000;

export interface PilotConfig {
  /** 'render-free' turns the pilot card on. Anything else (local, LAN, paid) leaves it off. */
  plan?: string;
  /** ISO date the free database was created. Defaults to the first migration's time (when the app first met it). */
  dbCreated?: string;
  /** Comma separated user ids allowed to see the pilot card and download backups. */
  adminIds?: string;
}

export const pilotConfigFromEnv = (env: NodeJS.ProcessEnv): PilotConfig => ({
  plan: env.T21_PILOT_PLAN ?? (env.RENDER ? 'render-free' : undefined),
  dbCreated: env.T21_PILOT_DB_CREATED,
  adminIds: env.T21_ADMIN_USER_IDS,
});

export interface PilotInfo {
  plan: string;
  dbCreatedAt: string;
  dbCreatedSource: 'env' | 'first_migration';
  dbExpiresAt: string;
  dbDeletedAt: string;
  daysLeft: number;
  dbBytes: number | null;
  dbLimitBytes: number;
  hoursPerMonth: number;
  /** ok: more than 7 days left; soon: 7 days or less; expired: database no longer usable (grace period). */
  state: 'ok' | 'soon' | 'expired';
}

export class Pilot {
  constructor(
    private db: Db,
    private cfg: PilotConfig,
    private now: () => number = Date.now,
  ) {}

  get enabled() {
    return this.cfg.plan === 'render-free';
  }

  /**
   * Who counts as the operator: the ids in T21_ADMIN_USER_IDS, or, when that is not set, the first account ever
   * created on this server (the person who deployed it opens it first). A deleted first account means no admin.
   */
  async isAdmin(userId: string): Promise<boolean> {
    const ids = (this.cfg.adminIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) return ids.includes(userId);
    const first = await this.db.query<{ id: string; deleted_at: Date | null }>('select id, deleted_at from users order by created_at, id limit 1');
    return !!first[0] && first[0].id === userId && !first[0].deleted_at;
  }

  async info(): Promise<PilotInfo | null> {
    if (!this.enabled) return null;
    let created: Date;
    let source: PilotInfo['dbCreatedSource'] = 'env';
    const fromEnv = this.cfg.dbCreated ? new Date(this.cfg.dbCreated) : null;
    if (fromEnv && !Number.isNaN(fromEnv.getTime())) created = fromEnv;
    else {
      const r = await this.db.query<{ t: Date | null }>('select min(applied_at) as t from schema_migrations');
      created = r[0]?.t ? new Date(r[0].t) : new Date(this.now());
      source = 'first_migration';
    }
    const expires = new Date(created.getTime() + FREE_DB_DAYS * DAY);
    const deleted = new Date(expires.getTime() + FREE_DB_GRACE_DAYS * DAY);
    const daysLeft = Math.ceil((expires.getTime() - this.now()) / DAY);
    let bytes: number | null = null;
    try {
      bytes = Number((await this.db.query<{ n: string }>('select pg_database_size(current_database()) as n'))[0].n);
    } catch {
      bytes = null; // embedded database: no size function
    }
    return {
      plan: this.cfg.plan!,
      dbCreatedAt: created.toISOString(),
      dbCreatedSource: source,
      dbExpiresAt: expires.toISOString(),
      dbDeletedAt: deleted.toISOString(),
      daysLeft,
      dbBytes: bytes,
      dbLimitBytes: FREE_DB_BYTES,
      hoursPerMonth: FREE_HOURS_PER_MONTH,
      state: daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'soon' : 'ok',
    };
  }
}
