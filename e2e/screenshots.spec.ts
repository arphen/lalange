import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const MODEL_MODAL_HEADING = /select neural engine|local processing setup/i;

function getOutputDir(isMobile: boolean) {
  const outputDir = path.join(process.cwd(), 'screenshots', isMobile ? 'mobile' : 'desktop');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function dismissEngineModalIfPresent(page: Page): Promise<void> {
  const modalHeading = page.getByRole('heading', { name: MODEL_MODAL_HEADING }).first();
  const modalVisible = await modalHeading.isVisible({ timeout: 2500 }).catch(() => false);

  if (!modalVisible) {
    return;
  }

  const skipButton = page.getByRole('button', { name: /not now|skip/i }).first();
  const canSkip = await skipButton.isVisible({ timeout: 1200 }).catch(() => false);
  if (canSkip) {
    await skipButton.click({ force: true });
    await expect(modalHeading).toBeHidden({ timeout: 10000 });
    return;
  }

  // Legacy modal path without a skip action.
  const firstEngineOption = page
    .getByRole('button', { name: /tinyllama|qwen|standard|higher quality/i })
    .first();
  await expect(firstEngineOption).toBeVisible({ timeout: 10000 });
  await firstEngineOption.click();

  const initializeButton = page.getByRole('button', { name: /initialize system|start setup/i }).first();
  await expect(initializeButton).toBeVisible({ timeout: 10000 });
  await initializeButton.click();

  await expect(modalHeading).toBeHidden({ timeout: 15000 });
}

async function captureScreenshot(
  page: Page,
  isMobile: boolean,
  filename: string,
): Promise<void> {
  const outputDir = getOutputDir(isMobile);
  await dismissEngineModalIfPresent(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: true });
}

async function hasDenseContextOnBothSides(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const top = document.querySelector('[data-testid="reader-context-top"]');
    const bottom = document.querySelector('[data-testid="reader-context-bottom"]');
    if (!top || !bottom) {
      return false;
    }

    const topWords = top.querySelectorAll('[data-index]').length;
    const bottomWords = bottom.querySelectorAll('[data-index]').length;
    return topWords >= 8 && bottomWords >= 8;
  });
}

async function ensureRiversEnabled(page: Page): Promise<void> {
  const topRiverToggle = page.locator('button[title*="previous context"]').first();
  const topTitle = await topRiverToggle.getAttribute('title');
  if (topTitle?.toLowerCase().includes('show')) {
    await topRiverToggle.click({ force: true });
  }

  const bottomRiverToggle = page.locator('button[title*="next context"]').first();
  const bottomTitle = await bottomRiverToggle.getAttribute('title');
  if (bottomTitle?.toLowerCase().includes('show')) {
    await bottomRiverToggle.click({ force: true });
  }
}

async function closeChaptersDrawerIfOpen(page: Page): Promise<void> {
  const chapterButtons = page.getByTestId('sidebar-chapter-button');
  const drawerIsOpen = await chapterButtons.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!drawerIsOpen) {
    return;
  }

  await page.getByTestId('toggle-chapters').click({ force: true });
  await page.waitForTimeout(500);
}

async function ensureChaptersDrawerOpen(page: Page): Promise<void> {
  const chapterButtons = page.getByTestId('sidebar-chapter-button');
  const drawerIsOpen = await chapterButtons.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (drawerIsOpen) {
    return;
  }

  await page.getByTestId('toggle-chapters').click({ force: true });
  await expect(chapterButtons.first()).toBeVisible({ timeout: 10000 });
}

async function loadFirstTextChapter(page: Page): Promise<void> {
  await ensureChaptersDrawerOpen(page);

  const firstChapterButton = page.getByTestId('sidebar-chapter-button').first();
  await firstChapterButton.click({ force: true });
  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(900);
}

async function jumpToReadableSubchapter(page: Page): Promise<void> {
  await ensureChaptersDrawerOpen(page);

  const readSubchapterButtons = page.locator('button[title="Read Subchapter"]');
  const subchapterCount = await readSubchapterButtons.count();
  if (subchapterCount === 0) {
    await loadFirstTextChapter(page);
    return;
  }

  // Prefer the second subchapter so we have text both above and below the live word.
  const targetIndex = subchapterCount > 1 ? 1 : 0;
  await readSubchapterButtons.nth(targetIndex).click({ force: true });
  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1000);
}

async function advanceToDenseReaderContext(page: Page): Promise<void> {
  const rsvpContainer = page.getByTestId('rsvp-container');
  await expect(rsvpContainer).toBeVisible({ timeout: 20000 });

  await closeChaptersDrawerIfOpen(page);
  await ensureRiversEnabled(page);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasDenseContextOnBothSides(page)) {
      return;
    }

    // Advance in two ways for resilience across desktop/mobile.
    await rsvpContainer.click();
    await page.waitForTimeout(2600);
    await rsvpContainer.click();

    await rsvpContainer.hover().catch(() => undefined);
    await page.mouse.wheel(0, 2200).catch(() => undefined);
    await page.waitForTimeout(450);
  }

  // Best-effort settle; some chapters may still be indexing when screenshots run.
  await page.waitForTimeout(900);
}

async function openArchiveAndLoadDemoIfNeeded(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await dismissEngineModalIfPresent(page);

  const firstBookCard = page.getByTestId('book-card').first();
  const hasBookAlready = await firstBookCard.isVisible({ timeout: 1500 }).catch(() => false);
  if (hasBookAlready) {
    return;
  }

  const loadDemoButton = page.getByTestId('archive-load-demo');
  await expect(loadDemoButton).toBeVisible({ timeout: 15000 });
  await loadDemoButton.click();

  await expect(firstBookCard).toBeVisible({ timeout: 90000 });
  await page.waitForTimeout(1200);
}

async function openReaderFromArchive(page: Page): Promise<void> {
  const firstBookCard = page.getByTestId('book-card').first();
  await expect(firstBookCard).toBeVisible({ timeout: 30000 });
  await firstBookCard.click();

  await page
    .locator('text=INITIALIZING COCKPIT...')
    .waitFor({ state: 'detached', timeout: 90000 })
    .catch(() => undefined);
  await dismissEngineModalIfPresent(page);
  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
}

// Longer timeout because demo ingestion and chapter analysis can take a while.
test.setTimeout(180000);

// Initialize localStorage with settings to bypass onboarding.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('xyz-settings', JSON.stringify({
      state: {
        hasCompletedOnboarding: true,
        theme: 'day',
      },
      version: 0,
    }));
  });
});

test('01 Reader Journey Key Flows', async ({ page, isMobile }) => {
  await openArchiveAndLoadDemoIfNeeded(page);
  await captureScreenshot(page, isMobile, '01-archive-with-real-book.png');

  await openReaderFromArchive(page);
  await jumpToReadableSubchapter(page);
  await captureScreenshot(page, isMobile, '02-reader-entry.png');

  await advanceToDenseReaderContext(page);
  await captureScreenshot(page, isMobile, '03-reader-live-rivers-current-play.png');

  await ensureChaptersDrawerOpen(page);
  const chapterButtons = page.getByTestId('sidebar-chapter-button');
  await expect(chapterButtons.first()).toBeVisible({ timeout: 10000 });
  await captureScreenshot(page, isMobile, '04-reader-chapters-drawer.png');

  const chapterCount = await chapterButtons.count();
  const targetChapterButton = chapterCount > 1 ? chapterButtons.nth(1) : chapterButtons.first();
  await targetChapterButton.evaluate((el) => {
    (el as HTMLElement).click();
  });

  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
  await advanceToDenseReaderContext(page);
  await captureScreenshot(page, isMobile, '05-reader-next-chapter-river-styling.png');
});
