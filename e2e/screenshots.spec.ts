import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

function getOutputDir(isMobile: boolean) {
  const outputDir = path.join(process.cwd(), 'screenshots', isMobile ? 'mobile' : 'desktop');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function dismissEngineModalIfPresent(page: Page): Promise<void> {
  const modalHeading = page.getByRole('heading', { name: /select neural engine|local processing setup/i });
  const modalVisible = await modalHeading.isVisible({ timeout: 3000 }).catch(() => false);

  if (!modalVisible) {
    return;
  }

  const skipButton = page.getByRole('button', { name: /not now|skip/i }).first();
  const canSkip = await skipButton.isVisible({ timeout: 1000 }).catch(() => false);
  if (canSkip) {
    await skipButton.click();
    await expect(modalHeading).toBeHidden({ timeout: 10000 });
    return;
  }

  const firstEngineOption = page
    .getByRole('button', { name: /tinyllama|qwen/i })
    .first();
  await expect(firstEngineOption).toBeVisible({ timeout: 10000 });
  await firstEngineOption.click();

  const initializeButton = page.getByRole('button', { name: /initialize system|start setup/i });
  await expect(initializeButton).toBeVisible({ timeout: 10000 });
  await initializeButton.click();

  await expect(modalHeading).toBeHidden({ timeout: 15000 });
}

async function captureRouteScreenshot(
  page: Page,
  isMobile: boolean,
  route: string,
  filename: string,
): Promise<void> {
  const outputDir = getOutputDir(isMobile);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await dismissEngineModalIfPresent(page);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: true });
}

// Set longer timeout for all tests.
test.setTimeout(90000);

// Initialize localStorage with settings to bypass onboarding.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('xyz-settings', JSON.stringify({
      state: {
        hasCompletedOnboarding: true,
        theme: 'volcanic',
      },
      version: 0,
    }));
  });
});

test('01 Archive Empty', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/', '01-archive-empty.png');
});

test('02 Settings Pacing', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/settings/pacing', '02-settings-pacing.png');
});

test('03 Settings Summarizer', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/settings/summarizer', '03-settings-summarizer.png');
});

test('04 Settings Librarian', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/settings/librarian', '04-settings-librarian.png');
});

test('05 Settings TTS', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/settings/tts', '05-settings-tts.png');
});

test('06 Library', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/library', '06-library.png');
});

test('07 Manual', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/manual', '07-manual.png');
});

test('08 Manifesto', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/manifesto', '08-manifesto.png');
});

test('09 Research', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/research', '09-research.png');
});

test('10 Sync', async ({ page, isMobile }) => {
  await captureRouteScreenshot(page, isMobile, '/sync', '10-sync.png');
});

test('11 Reader Flow', async ({ page, isMobile }) => {
  const outputDir = getOutputDir(isMobile);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await dismissEngineModalIfPresent(page);

  const loadDemoButton = page.getByRole('button', { name: /load demo/i });
  await expect(loadDemoButton).toBeVisible({ timeout: 15000 });
  await loadDemoButton.click();

  // Wait for the ingestion processing to complete (empty card is replaced by book card grid).
  await page.waitForSelector('text=by', { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outputDir, '11-archive-populated.png'), fullPage: true });

  // Click on the book card ('by') to open it.
  await page.click('text=by');

  // Wait for launcher loader to finish and transition to reader dashboard.
  await page.waitForSelector('text=INITIALIZING COCKPIT...', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outputDir, '12-reader-neutral.png'), fullPage: true });

  // Open Chapters Sidebar.
  const chaptersButton = page.locator('button[title="Chapters"]').first();
  await expect(chaptersButton).toBeVisible({ timeout: 10000 });
  await chaptersButton.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outputDir, '13-reader-chapters-drawer.png'), fullPage: true });
});
