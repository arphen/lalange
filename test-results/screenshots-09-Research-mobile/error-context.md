# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: screenshots.spec.ts >> 09 Research
- Location: e2e/screenshots.spec.ts:94:1

# Error details

```
TimeoutError: locator.waitFor: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('text=SELECT NEURAL ENGINE') to be detached
    14 × locator resolved to visible <h2 class="text-xl font-mono font-bold text-dune-gold tracking-widest uppercase">SELECT NEURAL ENGINE</h2>

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e8]: XYZ
      - button "OFFLINE" [ref=e11] [cursor=pointer]:
        - generic [ref=e15]: OFFLINE
        - img [ref=e16]
    - generic [ref=e18]:
      - button "Reader" [disabled] [ref=e19]
      - button "Archive" [ref=e20] [cursor=pointer]
      - button "Library" [ref=e21] [cursor=pointer]
      - button "Research" [ref=e22] [cursor=pointer]
      - button "Manual" [ref=e23] [cursor=pointer]
      - button "Settings" [ref=e24] [cursor=pointer]
    - button "Manifesto" [ref=e26] [cursor=pointer]
  - button "Open Menu" [ref=e27] [cursor=pointer]:
    - img [ref=e28]
  - generic [ref=e30]:
    - generic [ref=e32]:
      - generic [ref=e33]:
        - heading "SELECT NEURAL ENGINE" [level=2] [ref=e34]
        - paragraph [ref=e35]:
          - generic [ref=e36]: XYZ
          - text: runs entirely on your device. Select a model to download.
      - generic [ref=e38]:
        - button "TinyLlama (Logprobs) Standard 1.1B model. 700 MB" [ref=e39] [cursor=pointer]:
          - generic [ref=e40]:
            - generic [ref=e41]: TinyLlama (Logprobs)
            - generic [ref=e42]: Standard 1.1B model.
          - generic [ref=e43]: 700 MB
        - button "Qwen 2.5 1.5B (Logprobs) Higher quality 1.5B model. 980 MB" [ref=e44] [cursor=pointer]:
          - generic [ref=e45]:
            - generic [ref=e46]: Qwen 2.5 1.5B (Logprobs)
            - generic [ref=e47]: Higher quality 1.5B model.
          - generic [ref=e48]: 980 MB
      - button "Initialize System" [ref=e50] [cursor=pointer]
    - generic [ref=e52]:
      - generic [ref=e53]:
        - link "Cockpit" [ref=e54]:
          - /url: /
          - img [ref=e55]
          - text: Cockpit
        - generic [ref=e57]: Table of Contents
        - generic [ref=e58]:
          - button "01. Intervention" [ref=e59] [cursor=pointer]
          - button "02. The Exigent Sadist" [ref=e60] [cursor=pointer]
          - button "03. Local-First AI" [ref=e61] [cursor=pointer]
          - button "04. The Synapse" [ref=e62] [cursor=pointer]
          - button "05. The Librarian" [ref=e63] [cursor=pointer]
      - generic [ref=e65]:
        - generic [ref=e66]:
          - 'heading "Arphen: The Neuro-Semantic Scansion Engine" [level=1] [ref=e67]':
            - text: "Arphen: The Neuro-Semantic"
            - text: Scansion Engine
          - paragraph [ref=e68]: Technical & Theoretical Analysis // v1.0
        - generic [ref=e69]:
          - generic [ref=e70]:
            - heading "1. The Neuro-Semantic Intervention" [level=2] [ref=e71]
            - paragraph [ref=e72]: The Arphen project represents a radical departure from the prevailing paradigms of digital text consumption. Defined not as an "e-reader" but as a "neuro-semantic instrument," Arphen intervenes in the attention economy by fundamentally restructuring the mechanical act of reading.
            - paragraph [ref=e73]:
              - text: Where traditional e-readers (Kindle, Apple Books) remediate the physical book—preserving its static layout, pagination, and linear passivity—Arphen proposes a model of
              - strong [ref=e74]: "\"high-velocity data ingestion\""
              - text: mediated by local-first Artificial Intelligence.
          - generic [ref=e75]:
            - heading "1.1 Metabolism over Consumption" [level=3] [ref=e76]
            - paragraph [ref=e77]:
              - text: The central thesis is that the biological eye, with its reliance on saccadic movement, constitutes a "cognitive bottleneck." By coupling
              - strong [ref=e78]: Rapid Serial Visual Presentation (RSVP)
              - text: with
              - strong [ref=e79]: Entropy Modulation
              - text: —a variable pacing mechanism controlled by the perplexity calculations of a Local LLM—the system transfers the labor of pacing from the subject to the machine.
            - blockquote [ref=e80]: "\"It does not ask the user to read; it reads for the user, projecting the semantic content directly onto the retina.\""
        - paragraph [ref=e82]: Arphen Research Division // 2026
  - button "Made by Arphen" [ref=e84] [cursor=pointer]
```

# Test source

```ts
  13  | 
  14  | // Set longer timeout for all tests
  15  | test.setTimeout(90000);
  16  | 
  17  | // Initialize localStorage with settings to bypass onboarding
  18  | test.beforeEach(async ({ page }) => {
  19  |   await page.addInitScript(() => {
  20  |     window.localStorage.setItem('xyz-settings', JSON.stringify({
  21  |       state: {
  22  |         hasCompletedOnboarding: true,
  23  |         theme: 'volcanic'
  24  |       },
  25  |       version: 0
  26  |     }));
  27  |   });
  28  | });
  29  | 
  30  | test('01 Archive Empty', async ({ page, isMobile }) => {
  31  |   const outputDir = getOutputDir(isMobile);
  32  |   await page.goto('/');
  33  |   await page.waitForLoadState('domcontentloaded');
  34  |   await page.waitForTimeout(2000);
  35  |   await page.screenshot({ path: path.join(outputDir, '01-archive-empty.png'), fullPage: true });
  36  | });
  37  | 
  38  | test('02 Settings Pacing', async ({ page, isMobile }) => {
  39  |   const outputDir = getOutputDir(isMobile);
  40  |   await page.goto('/settings/pacing');
  41  |   await page.waitForLoadState('domcontentloaded');
  42  |   await page.waitForTimeout(2000);
  43  |   await page.screenshot({ path: path.join(outputDir, '02-settings-pacing.png'), fullPage: true });
  44  | });
  45  | 
  46  | test('03 Settings Summarizer', async ({ page, isMobile }) => {
  47  |   const outputDir = getOutputDir(isMobile);
  48  |   await page.goto('/settings/summarizer');
  49  |   await page.waitForLoadState('domcontentloaded');
  50  |   await page.waitForTimeout(2000);
  51  |   await page.screenshot({ path: path.join(outputDir, '03-settings-summarizer.png'), fullPage: true });
  52  | });
  53  | 
  54  | test('04 Settings Librarian', async ({ page, isMobile }) => {
  55  |   const outputDir = getOutputDir(isMobile);
  56  |   await page.goto('/settings/librarian');
  57  |   await page.waitForLoadState('domcontentloaded');
  58  |   await page.waitForTimeout(2000);
  59  |   await page.screenshot({ path: path.join(outputDir, '04-settings-librarian.png'), fullPage: true });
  60  | });
  61  | 
  62  | test('05 Settings TTS', async ({ page, isMobile }) => {
  63  |   const outputDir = getOutputDir(isMobile);
  64  |   await page.goto('/settings/tts');
  65  |   await page.waitForLoadState('domcontentloaded');
  66  |   await page.waitForTimeout(2000);
  67  |   await page.screenshot({ path: path.join(outputDir, '05-settings-tts.png'), fullPage: true });
  68  | });
  69  | 
  70  | test('06 Library', async ({ page, isMobile }) => {
  71  |   const outputDir = getOutputDir(isMobile);
  72  |   await page.goto('/library');
  73  |   await page.waitForLoadState('domcontentloaded');
  74  |   await page.waitForTimeout(2000);
  75  |   await page.screenshot({ path: path.join(outputDir, '06-library.png'), fullPage: true });
  76  | });
  77  | 
  78  | test('07 Manual', async ({ page, isMobile }) => {
  79  |   const outputDir = getOutputDir(isMobile);
  80  |   await page.goto('/manual');
  81  |   await page.waitForLoadState('domcontentloaded');
  82  |   await page.waitForTimeout(2000);
  83  |   await page.screenshot({ path: path.join(outputDir, '07-manual.png'), fullPage: true });
  84  | });
  85  | 
  86  | test('08 Manifesto', async ({ page, isMobile }) => {
  87  |   const outputDir = getOutputDir(isMobile);
  88  |   await page.goto('/manifesto');
  89  |   await page.waitForLoadState('domcontentloaded');
  90  |   await page.waitForTimeout(2000);
  91  |   await page.screenshot({ path: path.join(outputDir, '08-manifesto.png'), fullPage: true });
  92  | });
  93  | 
  94  | test('09 Research', async ({ page, isMobile }) => {
  95  |   const outputDir = getOutputDir(isMobile);
  96  |   await page.goto('/research');
  97  |   await page.waitForLoadState('domcontentloaded');
  98  |   await page.waitForTimeout(2000);
  99  |   // If the SELECT NEURAL ENGINE modal appears, select the first engine and confirm
  100 |   const engineModal = page.locator('text=SELECT NEURAL ENGINE');
  101 |   if (await engineModal.isVisible({ timeout: 3000 }).catch(() => false)) {
  102 |     // Click the first engine/model option (assuming it's a button or clickable card)
  103 |     const firstEngineOption = page.locator('[role="button"]:not([disabled])').first();
  104 |     if (await firstEngineOption.isVisible({ timeout: 2000 }).catch(() => false)) {
  105 |       await firstEngineOption.click();
  106 |     }
  107 |     // Click confirm/continue if present (look for a button with text Continue/Confirm/OK)
  108 |     const confirmButton = page.locator('button:has-text("CONTINUE"), button:has-text("CONFIRM"), button:has-text("OK")').first();
  109 |     if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
  110 |       await confirmButton.click();
  111 |     }
  112 |     // Wait for the modal to disappear
> 113 |     await engineModal.waitFor({ state: 'detached', timeout: 5000 });
      |                       ^ TimeoutError: locator.waitFor: Timeout 5000ms exceeded.
  114 |   }
  115 |   await page.screenshot({ path: path.join(outputDir, '09-research.png'), fullPage: true });
  116 | });
  117 | 
  118 | test('10 Sync', async ({ page, isMobile }) => {
  119 |   const outputDir = getOutputDir(isMobile);
  120 |   await page.goto('/sync');
  121 |   await page.waitForLoadState('domcontentloaded');
  122 |   await page.waitForTimeout(2000);
  123 |   await page.screenshot({ path: path.join(outputDir, '10-sync.png'), fullPage: true });
  124 | });
  125 | 
  126 | test('11 Reader Flow', async ({ page, isMobile }) => {
  127 |   const outputDir = getOutputDir(isMobile);
  128 |   await page.goto('/');
  129 |   await page.waitForLoadState('domcontentloaded');
  130 | 
  131 |   const loadDemoButton = page.locator('button:has-text("LOAD DEMO")');
  132 |   await expect(loadDemoButton).toBeVisible({ timeout: 15000 });
  133 |   await loadDemoButton.click();
  134 |   
  135 |   // Wait for the ingestion processing to complete (empty card is replaced by book card grid)
  136 |   await page.waitForSelector('text=by', { timeout: 60000 });
  137 |   await page.waitForTimeout(2000);
  138 |   await page.screenshot({ path: path.join(outputDir, '11-archive-populated.png'), fullPage: true });
  139 | 
  140 |   // Click on the book card ('by') to open it
  141 |   await page.click('text=by');
  142 |   
  143 |   // Wait for launcher loader to finish and transition to reader dashboard
  144 |   await page.waitForSelector('text=INITIALIZING COCKPIT...', { state: 'detached', timeout: 60000 });
  145 |   await page.waitForTimeout(4000); // Wait for canvas word player to settle
  146 |   await page.screenshot({ path: path.join(outputDir, '12-reader-neutral.png'), fullPage: true });
  147 | 
  148 |   // Open Chapters Sidebar
  149 |   const chaptersButton = page.locator('button[title="Chapters"]').first();
  150 |   await expect(chaptersButton).toBeVisible({ timeout: 10000 });
  151 |   await chaptersButton.click();
  152 |   await page.waitForTimeout(1000); // Allow slide-in CSS transition to complete
  153 |   await page.screenshot({ path: path.join(outputDir, '13-reader-chapters-drawer.png'), fullPage: true });
  154 | });
  155 | 
```