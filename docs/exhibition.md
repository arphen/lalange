a# Exhibition RSVP Rendering Pipeline Specification

## Objective
Build an automated pipeline to parse 18 Project Gutenberg texts, render them via the existing RSVP React application, capture individual video files for each text, and stitch them into a 3840x2160 (16:9) anamorphic video grid suitable for a 3x2 physical monitor wall. i will be exhibiting this and need a clean render.

## Architectural Constraints

- **Branching:** All work must be done on a new branch: `feature/exhibition-render`.
- **Anamorphic Output:** The target export is 3840x2160. The layout requires a 3x2 grid. Each grid cell is 1280x1080.
- **Distortion:** The text inside each cell MUST be compressed horizontally by `0.666667` to counteract the hardware stretch of the exhibition monitors.
- **Duration:** - Test mode: 6 books, 30 seconds.

- Production mode: 18 books total, processed in 3 batches of 6. Each batch is 10 minutes long. Total duration: 30 minutes.

## Phase 1: Text Parsing & Validation

1. **Source:** Read `.epubs` files from `books/.
2. **Sanitization and validation Script (`scripts/parse_books.js`):**

- make sure the gutenberg headers are skipped/ removed. (this needs to be ensured, it will be very disturbing during playback
- Filter out massive whitespace or unreadable characters.
- Validate that  all read books exist and can be successfully parsed.
- Output the sanitized texts as JSON arrays of words (or clean text files) into `public/exhibition-texts/`.

## Phase 2: React Application Modifications
Modify the React app to support an automated "Exhibition Render" mode.

1. **Routing / State:** Add URL parameter support (e.g., `?exhibition=true&book=book_id&duration=600`).
2. **Anamorphic CSS:** When `exhibition=true`, wrap the RSVP display in a container with:

```
width: 1280px;
height: 1080px;
transform: scaleX(0.666667);
transform-origin: center center;
background-color: black;
color: white;
```
3. **In-Browser Recording (`MediaRecorder` API):**

- When the component mounts in exhibition mode, programmatically initialize `MediaRecorder` on a `<canvas>` element (if using canvas) or use a DOM-to-Canvas capture loop synchronized with the RSVP tick.
- Start recording immediately when the text starts.
- Stop recording exactly at the `duration` limit.
- Automatically trigger a file download of the resulting `.webm` file named `{book_id}.webm`.

## Phase 3: The Orchestrator Script (`scripts/render_books.js`)
Write a Puppeteer (Node.js) script to orchestrate the rendering.

1. **Launch:** Start a headless Chromium instance (using `--window-size=1280,1080`).
2. **Loop:** For a given array of book IDs:

- Navigate to `http://localhost:5173/?exhibition=true&book=${book_id}&duration=${duration}`
- Wait for the specific duration.
- Intercept the browser's download event, save the `{book_id}.webm` to a `renders/raw/` directory.
- Close page and repeat for the next book.

## Phase 4: FFmpeg Stitching (`scripts/stitch_grid.sh`)
Write a bash script that takes exactly 6 video files and tiles them into a 3840x2160 grid.

- Use the FFmpeg `xstack` filter.
- Layout: 3 columns, 2 rows.
- Input resolution: 1280x1080. Output resolution: 3840x2160.
- Ensure the output is encoded in `libx264`, `-crf 18` for high quality.
- The script should be able to process Batch 1, Batch 2, and Batch 3 separately, and then concatenate the three 10-minute outputs into the final 30-minute `exhibition_final.mp4`.

## Phase 5: The Makefile Interface
Extend the existing `Makefile` with the following commands to ensure complete reproducibility without AI assistance.

```
# Variables
DOWNLOADS_DIR = ~/downloads
RAW_RENDERS = renders/raw
FINAL_RENDERS = renders/final

.PHONY: setup-exhibition parse-books render-test render-full clean-renders

setup-exhibition:
    git checkout -b feature/exhibition-render
    npm install puppeteer --save-dev
    mkdir -p $(RAW_RENDERS) $(FINAL_RENDERS) public/exhibition-texts

parse-books:
    node scripts/parse_books.js --source=$(DOWNLOADS_DIR)

# Renders 6 books for 30 seconds, stitches them.
render-test: parse-books
    node scripts/render_books.js --batch=test --duration=30
    bash scripts/stitch_grid.sh --batch=test
    
# Renders 3 batches of 6 books for 10 minutes each, stitches grids, concatenates final.
render-full: parse-books
    node scripts/render_books.js --batch=all --duration=600
    bash scripts/stitch_grid.sh --batch=1
    bash scripts/stitch_grid.sh --batch=2
    bash scripts/stitch_grid.sh --batch=3
    bash scripts/concatenate.sh
    
clean-renders:
    rm -rf $(RAW_RENDERS)/* $(FINAL_RENDERS)/*
```

## Implementation Steps for Claude

1. Read this document thoroughly.
2. Execute `git checkout -b feature/exhibition-render`.
3. Implement Phase 1 (`scripts/parse_books.js`). Ask the user to confirm the 18 texts parsed successfully.
4. Implement Phase 2 (React App logic for `?exhibition=true`).
5. Implement Phase 3 (Puppeteer script).
6. Implement Phase 4 (FFmpeg bash scripts).
7. Update the `Makefile` as specified in Phase 5.
8. Run `make render-test` to validate the entire pipeline end-to-end.