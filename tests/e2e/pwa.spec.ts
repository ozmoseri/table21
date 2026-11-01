import { expect, test } from '@playwright/test';

test('PWA: manifest, icons, apple touch icon and service worker are served and valid', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m).toMatchObject({ short_name: 'TABLE21', display: 'standalone', start_url: '/', lang: 'he', dir: 'rtl' });
  const sizes = m.icons.map((i: any) => `${i.sizes}:${i.purpose ?? 'any'}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const icon of [...m.icons.map((i: any) => i.src), '/icons/apple-touch-icon.png']) {
    const r = await request.get(icon);
    expect(r.status(), icon).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain('PRECACHE');
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});
