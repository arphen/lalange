import { test, expect } from '@playwright/test';

// iPhone-sized viewport in both browser projects; the app's own `mobile` project
// is device-emulated, this keeps the check identical on desktop Chrome too.
test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

// In an installed PWA iOS draws the page under the Dynamic Island and the home
// indicator, so env(safe-area-inset-*) is non-zero. Headless browsers always
// report 0, so override the tokens the app reads to simulate an iPhone 16 Pro.
const IPHONE_INSETS = `:root {
  --safe-top: 59px;
  --safe-right: 0px;
  --safe-bottom: 34px;
  --safe-left: 0px;
}`;

const ISLAND_BOTTOM = 50;
const HOME_INDICATOR_TOP = 852 - 34;

test('top and bottom chrome stay clear of the iOS safe area', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: IPHONE_INSETS });

  const hamburger = page.getByTitle('Open Menu');
  await expect(hamburger).toBeVisible();
  expect((await hamburger.boundingBox())!.y).toBeGreaterThanOrEqual(ISLAND_BOTTOM);

  const themeToggle = page.getByRole('button', { name: /Switch to .* theme/ });
  expect((await themeToggle.boundingBox())!.y).toBeGreaterThanOrEqual(ISLAND_BOTTOM);

  const madeBy = page.getByRole('button', { name: /Made by Arphen/i });
  const madeByBox = (await madeBy.boundingBox())!;
  expect(madeByBox.y + madeByBox.height).toBeLessThanOrEqual(HOME_INDICATOR_TOP);

  await hamburger.click();
  const archiveNav = page.getByRole('button', { name: 'Archive', exact: true });
  await expect(archiveNav).toBeVisible();
  expect((await archiveNav.boundingBox())!.y).toBeGreaterThanOrEqual(ISLAND_BOTTOM);
});
