export * from './cards.ts';
export * from './round.ts';

/** Currency helpers. Wallet amounts are integer half-coin units: 2 units = 1 coin. */
export const UNITS_PER_COIN = 2;
export const coinsToUnits = (coins: number): number => {
  if (!Number.isSafeInteger(coins)) throw new RangeError('coins must be an integer');
  return coins * UNITS_PER_COIN;
};
export const unitsToCoins = (units: number): number => units / UNITS_PER_COIN;
