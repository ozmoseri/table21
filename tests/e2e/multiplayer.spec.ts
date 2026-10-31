import { expect, test } from '@playwright/test';
import { SHOTS, assertRedacted, bet, createRoom, joinRoom, lastSnapshot, onboard, player, playRound, sit, sitAndBet } from './helpers.ts';

test('three separate browsers: create, join, bet, play turns, dealer, settle, balances match server', async ({ browser }) => {
  const a = await player(browser, 'עוז');
  const b = await player(browser, 'דניאל');
  const c = await player(browser, 'Maya');
  await onboard(a, 0);
  await onboard(b, 1);
  await onboard(c, 3);
  const code = await createRoom(a);
  expect(code).toMatch(/^[0-9A-Z]{6}$/);
  await joinRoom(b, code);
  await joinRoom(c, code);

  // Everyone sits first; the early deal waits while anyone connected is still only watching.
  await sit(a);
  await sit(b);
  await sit(c);
  await bet(a, 100);
  await bet(b, 50);
  await bet(c, 25);
  // All seated players bet: the server auto-deals.
  await expect(a.page.locator('.dealer-cards .card')).toHaveCount(2, { timeout: 10_000 });
  await a.page.waitForTimeout(900);
  await a.page.screenshot({ path: `${SHOTS}/table-3-players.png` });

  let turn = 0;
  await playRound([a, b, c], () => (turn++ % 3 === 0 ? 'hit' : 'stand'));
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: `${SHOTS}/round-result.png` });

  // All three see the same dealer cards and identical round id.
  const snaps = [a, b, c].map(lastSnapshot);
  expect(new Set(snaps.map((s) => s.round.roundId)).size).toBe(1);
  expect(JSON.stringify(snaps[1].round.dealer)).toBe(JSON.stringify(snaps[0].round.dealer));
  expect(JSON.stringify(snaps[2].round.dealer)).toBe(JSON.stringify(snaps[0].round.dealer));

  // Authoritative wallet equals 2,000 coins - stakes + gross returns shown in the round.
  for (const p of [a, b, c]) {
    const s = lastSnapshot(p);
    const mine = s.round.seats.find((x: any) => x.playerId === s.you.userId);
    const stake = mine.hands.reduce((t: number, h: any) => t + h.stakeUnits, 0);
    const ret = mine.hands.reduce((t: number, h: any) => t + (h.returnedUnits ?? 0), 0);
    const me = await p.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    expect(me.wallet.availableUnits).toBe(4000 - stake + ret);
    expect(me.wallet.reservedUnits).toBe(0);
    expect(assertRedacted(p)).toBe(true);
  }
  for (const p of [a, b, c]) await p.ctx.close();
});

test('network drop and page refresh: player reconnects to the same hand and finishes it', async ({ browser }) => {
  const a = await player(browser, 'Host');
  const b = await player(browser, 'Roni');
  await onboard(a, 2);
  await onboard(b, 4);
  const code = await createRoom(a);
  await joinRoom(b, code);
  await sit(a);
  await sit(b);
  await bet(a, 10);
  await bet(b, 10);
  await expect(a.page.locator('.dealer-cards .card')).toHaveCount(2, { timeout: 10_000 });
  const roundId = lastSnapshot(b).round?.roundId ?? (await b.page.waitForTimeout(500), lastSnapshot(b).round.roundId);

  // b drops off the network: a sees b as offline; b sees the reconnecting banner.
  await b.ctx.setOffline(true);
  await expect(b.page.getByText('מתחברים מחדש')).toBeVisible({ timeout: 15_000 });
  await expect(a.page.locator('.seat.is-offline')).toBeVisible({ timeout: 15_000 });
  await b.ctx.setOffline(false);
  await expect(b.page.getByText('מתחברים מחדש')).toBeHidden({ timeout: 15_000 });
  expect(lastSnapshot(b).round.roundId).toBe(roundId);

  // Refresh mid-round: state comes back from the server snapshot.
  await b.page.reload();
  await expect(b.page.getByTestId('room')).toBeVisible();
  await expect(b.page.locator('.my-hands .card')).toHaveCount(2, { timeout: 10_000 });
  await playRound([a, b]);
  expect(lastSnapshot(b).round.roundId).toBe(roundId);
  await a.ctx.close();
  await b.ctx.close();
});

test('friend as presenter dealer: cannot see the hole card, triggers steps, auto dealer takes over on disconnect', async ({ browser }) => {
  const host = await player(browser, 'Player1');
  const dealer = await player(browser, 'הדילר');
  await onboard(host, 5);
  await onboard(dealer, 6);
  const code = await createRoom(host, { human: true });
  await joinRoom(dealer, code);
  await dealer.page.getByTestId('claim-dealer').click();
  await expect(dealer.page.getByTestId('sit')).toHaveCount(0);
  await sitAndBet(host, 50);
  await dealer.page.getByTestId('deal').click();
  await expect(host.page.locator('.act-stand')).toBeVisible({ timeout: 10_000 });
  await host.page.locator('.act-stand').click();
  const step = dealer.page.getByTestId('dealer-step');
  await expect(step).toBeVisible();
  expect(assertRedacted(dealer)).toBe(true);
  await dealer.page.screenshot({ path: `${SHOTS}/presenter-dealer.png` });
  await step.click(); // reveal
  await expect(dealer.page.locator('.dealer-cards .card.is-down')).toHaveCount(0);
  // The presenter leaves; the automatic dealer finishes with the same mandatory draws.
  await dealer.ctx.close();
  await expect(host.page.getByTestId('result-panel')).toBeVisible({ timeout: 20_000 });
  const me = await host.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  expect(me.wallet.reservedUnits).toBe(0);
  await host.ctx.close();
});
