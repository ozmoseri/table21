/**
 * Rewarded ads adapter boundary. Disabled until a real provider, app/ad-unit IDs, SDK and
 * server-side verification are configured. There is intentionally no demo or simulated reward path.
 *
 * A future provider must: verify the reward server-side (e.g. AdMob SSV signature), use the provider's unique
 * transaction id as the ledger idempotency key (kind 'grant_ad'), enforce a cap/cooldown, never credit during a
 * hand, and never apply to equal-stack match wallets or gameplay rankings.
 */
export interface RewardedAdProvider {
  id: string;
  verifyCallback(raw: Record<string, string>): Promise<{ valid: boolean; transactionId: string; userId: string; rewardUnits: number }>;
}

export function adsStatus(): { enabled: false; reason: 'not_configured' } {
  return { enabled: false, reason: 'not_configured' };
}
