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
  const toggle = page.getByTestId('toggle-chapters');
  if (await toggle.getAttribute('aria-expanded') !== 'true') return;

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

async function ensureChaptersDrawerOpen(page: Page): Promise<void> {
  const toggle = page.getByTestId('toggle-chapters');
  if (await toggle.getAttribute('aria-expanded') === 'true') return;

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('sidebar-container')).toHaveAttribute('aria-hidden', 'false');
}

async function waitForChapterTransition(page: Page): Promise<void> {
  const transitionStatus = page.getByTestId('reader-shell').locator('[role="status"]');
  await expect(transitionStatus).toHaveCount(1, { timeout: 3000 });
  await expect(transitionStatus).toHaveCount(0, { timeout: 10000 });
}

async function loadFirstTextChapter(page: Page): Promise<void> {
  await ensureChaptersDrawerOpen(page);

  const firstChapterButton = page.getByTestId('sidebar-chapter-button').first();
  if (await firstChapterButton.getAttribute('aria-current') === 'page') {
    await closeChaptersDrawerIfOpen(page);
  } else {
    await firstChapterButton.click();
    await waitForChapterTransition(page);
  }
  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
}

async function jumpToReadableSubchapter(page: Page): Promise<void> {
  await ensureChaptersDrawerOpen(page);

  const readSubchapterButtons = page.locator('button[data-testid^="subchapter-btn-"]:not([disabled])');
  const subchapterCount = await readSubchapterButtons.count();
  if (subchapterCount === 0) {
    await loadFirstTextChapter(page);
    return;
  }

  // Prefer the second subchapter so we have text both above and below the live word.
  const targetIndex = subchapterCount > 1 ? 1 : 0;
  await readSubchapterButtons.nth(targetIndex).click();
  await waitForChapterTransition(page);
  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
}

async function expectReaderPlaybackToAdvance(page: Page): Promise<void> {
  const rsvpContainer = page.getByTestId('rsvp-container');
  const focusLane = rsvpContainer.locator('.reader-focus-lane');
  await expect(rsvpContainer).toHaveAttribute('aria-pressed', 'true');
  const initialWord = (await focusLane.innerText()).trim();

  await expect.poll(
    async () => (await focusLane.innerText()).trim(),
    { timeout: 3000, intervals: [100, 150, 200] },
  ).not.toBe(initialWord);
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
  await expectReaderPlaybackToAdvance(page);
  await captureScreenshot(page, isMobile, '02-reader-entry.png');

  await advanceToDenseReaderContext(page);
  await captureScreenshot(page, isMobile, '03-reader-live-rivers-current-play.png');

  await closeChaptersDrawerIfOpen(page);
  const closedToolbarBox = await page.getByTestId('reader-toolbar-controls').boundingBox();
  await ensureChaptersDrawerOpen(page);
  const chapterButtons = page.getByTestId('sidebar-chapter-button');
  await expect(chapterButtons.first()).toBeVisible({ timeout: 10000 });
  const drawerBox = await page.getByTestId('sidebar-container').boundingBox();
  const toolbarBox = await page.getByTestId('reader-toolbar-controls').boundingBox();
  expect(closedToolbarBox).not.toBeNull();
  expect(drawerBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  const contentsHeaderBox = await page.getByRole('heading', { name: 'Contents' }).boundingBox();
  expect(contentsHeaderBox).not.toBeNull();
  expect(contentsHeaderBox!.x).toBeGreaterThanOrEqual(drawerBox!.x);
  expect(contentsHeaderBox!.y).toBeGreaterThanOrEqual(drawerBox!.y);
  expect(Math.abs(toolbarBox!.x - closedToolbarBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(toolbarBox!.y - closedToolbarBox!.y)).toBeLessThanOrEqual(1);
  expect(toolbarBox!.y).toBeLessThanOrEqual(20);
  if (isMobile) {
    expect(drawerBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height - 1);
  } else {
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(drawerBox!.x + 1);
  }
  await expect(page.getByRole('button', { name: /fullscreen/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /focus mode|exit focus mode/i })).toBeVisible();
  const pacingControl = page.getByRole('button', { name: /adaptive pacing/i }).first();
  await expect(pacingControl).toBeVisible();
  if (await pacingControl.getAttribute('aria-label') === 'Adaptive pacing unavailable') {
    await expect(pacingControl).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Set up adaptive pacing' })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Listen' })).toBeVisible();
  await expect(page.getByRole('button', { name: /switch to (dark|day) theme/i })).toBeVisible();
  await expect(page.getByTestId('toggle-chapters')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close contents' })).toHaveCount(1);
  const toolbarButtons = page.getByTestId('reader-toolbar-controls').getByRole('button');
  const firstToolBox = await toolbarButtons.nth(0).boundingBox();
  const secondToolBox = await toolbarButtons.nth(1).boundingBox();
  expect(firstToolBox).not.toBeNull();
  expect(secondToolBox).not.toBeNull();
  expect(Math.abs(firstToolBox!.y - secondToolBox!.y)).toBeLessThanOrEqual(1);
  expect(secondToolBox!.x).toBeGreaterThanOrEqual(firstToolBox!.x + firstToolBox!.width - 1);
  if (!isMobile) {
    const speedControlsBox = await page.getByTestId('speed-controls').boundingBox();
    expect(speedControlsBox).not.toBeNull();
    expect(speedControlsBox!.x + speedControlsBox!.width).toBeLessThanOrEqual(drawerBox!.x);
  }
  await captureScreenshot(page, isMobile, '04-reader-chapters-drawer.png');

  const chapterCount = await chapterButtons.count();
  const targetChapterButton = chapterCount > 1 ? chapterButtons.nth(1) : chapterButtons.first();
  await targetChapterButton.evaluate((el) => {
    (el as HTMLElement).click();
  });
  if (chapterCount > 1) {
    await waitForChapterTransition(page);
  }

  await expect(page.getByTestId('rsvp-container')).toBeVisible({ timeout: 30000 });
  await advanceToDenseReaderContext(page);
  await captureScreenshot(page, isMobile, '05-reader-next-chapter-river-styling.png');
});

test('02 Dark reader is one continuous surface', async ({ page, isMobile }) => {
  await openArchiveAndLoadDemoIfNeeded(page);
  await openReaderFromArchive(page);
  await jumpToReadableSubchapter(page);

  const darkThemeButton = page.getByRole('button', { name: 'Switch to dark theme' });
  if (await darkThemeButton.isVisible().catch(() => false)) {
    await darkThemeButton.click();
  }
  await closeChaptersDrawerIfOpen(page);

  const readerStyles = await page.evaluate(() => {
    const shell = document.querySelector('.reader-shell');
    const lane = document.querySelector('.reader-focus-lane');
    const word = lane?.firstElementChild;
    const speedDock = document.querySelector('.reader-speed-dock');

    return {
      shellBackground: shell ? getComputedStyle(shell).backgroundColor : null,
      laneBackground: lane ? getComputedStyle(lane).backgroundColor : null,
      wordFilter: word ? getComputedStyle(word).filter : null,
      speedBackground: speedDock ? getComputedStyle(speedDock).backgroundColor : null,
      speedShadow: speedDock ? getComputedStyle(speedDock).boxShadow : null,
    };
  });

  expect(readerStyles).toEqual({
    shellBackground: 'rgb(5, 6, 6)',
    laneBackground: 'rgba(0, 0, 0, 0)',
    wordFilter: 'none',
    speedBackground: 'rgba(0, 0, 0, 0)',
    speedShadow: 'none',
  });
  await captureScreenshot(page, isMobile, '06-reader-dark-seamless.png');

  await ensureChaptersDrawerOpen(page);
  const contentsStyles = await page.evaluate(() => {
    const chapter = document.querySelector('.reader-chapter-row');
    const section = document.querySelector('.reader-section-row--active');
    const bookProgress = document.querySelector('.reader-contents-progress .reader-progress-track');
    const chapterProgress = chapter?.querySelector('.reader-progress-track');

    return {
      chapterBackground: chapter ? getComputedStyle(chapter).backgroundColor : null,
      chapterShadow: chapter ? getComputedStyle(chapter).boxShadow : null,
      sectionBackground: section ? getComputedStyle(section).backgroundColor : null,
      bookProgressHeight: bookProgress ? getComputedStyle(bookProgress).height : null,
      chapterProgressHeight: chapterProgress ? getComputedStyle(chapterProgress).height : null,
      sectionLocation: section?.getAttribute('aria-current') === 'location' && section.textContent?.includes('Here'),
    };
  });

  expect(contentsStyles).toEqual({
    chapterBackground: 'rgba(0, 0, 0, 0)',
    chapterShadow: 'none',
    sectionBackground: 'rgba(0, 0, 0, 0)',
    bookProgressHeight: '3px',
    chapterProgressHeight: '3px',
    sectionLocation: true,
  });
  await captureScreenshot(page, isMobile, '07-reader-dark-contents.png');
});
