import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const SHOTS = 'docs/screenshots';

export interface Player {
  ctx: BrowserContext;
  page: Page;
  name: string;
  frames: string[];
}

/** Opens an isolated browser context (separate cookies = separate server identity) and records socket frames. */
export async function player(browser: Browser, name: string, viewport = { width: 390, height: 844 }): Promise<Player> {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  return { ctx, page, name, frames };
}

export async function onboard(p: Player, avatarIndex = 0) {
  await p.page.goto('/');
  await p.page.getByPlaceholder('שם תצוגה').fill(p.name);
  await p.page.locator('.avatar-pick').nth(avatarIndex).click();
  await p.page.getByRole('button', { name: 'שמירה וכניסה' }).click();
  await expect(p.page.getByTestId('play-friends')).toBeEnabled();
}

export async function createRoom(p: Player, opts: { human?: boolean; match?: boolean } = {}): Promise<string> {
  await p.page.getByTestId(opts.match ? 'play-friends' : 'play-friends').click();
  if (opts.match) await p.page.getByRole('radio', { name: /ערב חברים/ }).click();
  if (opts.human) await p.page.getByRole('radio', { name: /חבר בתפקיד הדילר/ }).click();
  await p.page.getByTestId('create-room').click();
  await expect(p.page.getByTestId('room')).toBeVisible();
  return p.page.url().split('#/r/')[1];
}

export async function joinRoom(p: Player, code: string) {
  await p.page.goto(`/#/r/${code}`);
  await expect(p.page.getByTestId('room')).toBeVisible();
}

export async function sitAndBet(p: Player, coins: number) {
  await p.page.getByTestId('sit').click();
  await p.page.locator('.stake-chip', { hasText: new RegExp(`^${coins}$`) }).click();
}

/** Every room:state snapshot this player received over the socket, parsed. */
export function snapshots(p: Player): any[] {
  return p.frames
    .filter((f) => f.startsWith('42["room:state"'))
    .map((f) => JSON.parse(f.slice(2))[1])
    .concat(
      p.frames
        .filter((f) => /^43\d*\[\{"ok":true,"snapshot"/.test(f))
        .map((f) => JSON.parse(f.replace(/^43\d*/, ''))[0].snapshot),
    );
}

export function lastSnapshot(p: Player): any {
  return snapshots(p).sort((a, b) => a.version - b.version).at(-1);
}

/** Asserts the network never carried the shoe, physical ids or an unrevealed hole card's identity. */
export function assertRedacted(p: Player) {
  for (const f of p.frames) {
    expect(f).not.toContain('"shoe"');
    expect(f).not.toContain('"uid"');
  }
  let sawHidden = false;
  for (const s of snapshots(p)) {
    const hole = s?.round?.dealer?.cards?.[1];
    if (hole && !s.round.dealer.revealed) {
      sawHidden = true;
      expect(hole.hidden).toBe(true);
      expect(hole.rank).toBeUndefined();
      expect(hole.suit).toBeUndefined();
    }
  }
  return sawHidden;
}

/** Plays whatever turn is pending on any page until every page shows the round result. */
export async function playRound(players: Player[], choose: (p: Player) => 'hit' | 'stand' = () => 'stand') {
  const deadline = Date.now() + 60_000;
  for (;;) {
    let acted = false;
    for (const p of players) {
      const btn = p.page.locator(`.act-${choose(p)}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        acted = true;
      } else {
        const stand = p.page.locator('.act-stand');
        if (await stand.isVisible().catch(() => false)) {
          await stand.click().catch(() => {});
          acted = true;
        }
      }
    }
    const done = await Promise.all(players.map((p) => p.page.getByTestId('result-panel').isVisible().catch(() => false)));
    if (done.every(Boolean)) return;
    if (Date.now() > deadline) throw new Error('round did not finish');
    if (!acted) await players[0].page.waitForTimeout(150);
  }
}
