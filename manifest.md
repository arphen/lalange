# **XYZ: The Architecture of the Signifier in a Post-App Store Ecosystem**

## **I. Introduction: The Psychoanalysis of Velocity**

The conception of "XYZ" arises at the intersection of psychoanalytic theory and high-performance software engineering. It is a project born from a desire to confront the "Real" of the text—not through the measured, ego-driven comprehension of traditional reading, but through an acceleration that bypasses the censor of the conscious mind. The user’s requirement to read at 800 to 1,000 words per minute (wpm) is not merely a metric of efficiency; it is a structural intervention in the subject’s relationship to language. In Lacanian terms, the ego functions as a mechanism of defense, a buffering agent that imposes imaginary coherence upon the chaotic flux of signifiers. By pushing the velocity of reading beyond the ego’s comfort zone, XYZ aims to induce a "trip" in this defense mechanism, allowing the signifying chain to impact the unconscious directly, akin to the concept of *lalangue*—language in its raw, material, and enjoyment-filled state before it is ordered by the laws of grammar and meaning.  
However, the realization of this psychoanalytic reading machine faces a distinct confrontation with another form of the "Real": the constraints of the modern mobile ecosystem. The user’s transition from Android to iPhone introduces a prohibition—the Apple App Store, with its demands for registration, payment, and adherence to the "Name-of-the-Father" (Apple’s review guidelines). To build XYZ is to circumvent this symbolic authority without engaging with it. This necessitates a Progressive Web Application (PWA) architecture, a solution that places the application in the contested territory of the browser. Here, the developer must navigate the capricious laws of iOS Safari, specifically its storage eviction policies, while maintaining the performance fidelity required for a 1,000 wpm RSVP (Rapid Serial Visual Presentation) loop.  
This report provides an exhaustive technical and theoretical roadmap for building XYZ. It addresses the architectural schism between the "Server" (the Laptop/Big Other) and the "Client" (the Phone/Subject), proposing a conflict-free, offline-first data strategy that ensures the integrity of the library even during prolonged disconnects—symbolized by the "long ferry ride." It details the heuristic algorithms required to transmute the rigid, non-semantic structure of PDFs into the fluid stream of the RSVP reader, and it outlines the integration of Generative AI (Gemini) as the "Analyst," a tool for retroactive resignification of the text.

## ---

**II. The Browser as the "Real": Navigating iOS PWA Constraints**

The decision to bypass the App Store necessitates a confrontation with the browser environment on iOS (WebKit), which, unlike the native environment or the Android ecosystem, is characterized by limitations that often appear arbitrary and traumatic to the persistence of application state. For a speed reading application that aims to host a user's entire library and function offline for days, the browser's ephemeral nature is the primary antagonist.

### **2.1 The "Seven-Day Castration": Safari’s Eviction Policy**

The most significant technical hurdle for a long-living offline PWA on iOS is the browser's data eviction policy. Research indicates a distinct divergence in how browsers handle data persistence, with Safari acting as a merciless agent of hygiene. Since iOS 13.4, and continuing into current iterations, WebKit has enforced a seven-day cap on all script-writable storage—including IndexedDB, LocalStorage, and the Cache API—for web pages that the user does not interact with. If the user does not tap or click on the website within seven days, the browser wipes all local data to prevent cross-site tracking.1  
This policy poses an existential threat to XYZ. If a user loads their library on the phone but then sets it aside for a week—perhaps reading a physical book or simply being busy—they would return to find their digital library obliterated, a "castration" of their reading history. However, a critical exception exists, one that acts as the "symptom" allowing the app to survive. The eviction policy does *not* apply to PWAs that have been added to the Home Screen. When a user installs the app via the "Add to Home Screen" share action, it gains a reprieve from the seven-day limit, effectively entering a different class of storage citizenship.1  
This creates a mandatory user experience (UX) requirement: the "install" action is not optional; it is structural. The application must aggressively detect if it is running in standalone mode (the display mode for installed PWAs). If it detects that it is running in a standard browser tab, it must present a blocking or highly persistent notification instructing the user to add the app to their Home Screen immediately. This is the only way to ensure that the "ferry ride" scenario—where the device might be used intermittently without server contact—does not result in data loss.

### **2.2 The Object *a* of Disk Space: Quotas and Persistence**

While Android (Chrome) allows an origin to use up to 60% of the total disk size—potentially granting hundreds of gigabytes for a massive library—iOS is historically far more restrictive.6 Legacy implementations of WebSQL were capped at 50MB, and while modern IndexedDB on iOS is more generous (often allowing up to 1GB or more depending on available free space), it remains "promiscuous" with eviction if the device’s overall disk space runs low.7  
The introduction of the **Origin Private File System (OPFS)**, part of the File System Access API, represents a significant evolution. OPFS provides a storage area that is optimized for performance and random access, distinct from the standard browser cache. It is less susceptible to the arbitrary eviction logic that governs the cache, as it is treated more like user-generated data. For XYZ, which requires storing binary blobs of EPUB and PDF files, OPFS is the superior storage target compared to converting files to Base64 strings in IndexedDB, which incurs significant memory overhead. However, Safari’s implementation of OPFS is recent, and its interaction with the 7-day rule in "browser tab" mode remains opaque, reinforcing the necessity of the Home Screen installation strategy.3

| Storage Feature | iOS Safari (WebKit) | Android (Chrome) | Implication for XYZ |
| :---- | :---- | :---- | :---- |
| **IndexedDB** | Supported, but subject to 7-day eviction in tabs. | Persistent, allows huge quotas (60% disk). | Use for metadata (authors, titles, reading progress). |
| **OPFS** | Supported (Recent), high performance. | Fully supported. | Use for storing the actual book files (EPUB/PDF blobs). |
| **Cache API** | 50MB limit in some contexts, shared quota. | Flexible quota. | Use for app assets (HTML, JS, CSS) via Service Worker. |
| **Persistence** | navigator.storage.persist() is weak/opaque. | Respected based on site engagement. | Must treat "Add to Home Screen" as the persistence switch. |

### **2.3 The Screen Wake Lock: Maintaining the Gaze**

To read at 1,000 wpm for long durations without physically interacting with the screen, the phone must not sleep. The "gaze" of the phone must remain open. Historically, web apps resorted to hacks like playing a silent looped video in the background to prevent the screen from dimming. However, the **Screen Wake Lock API** is now supported in iOS Safari 16.4+.9 This API allows the application to request a screen lock, preventing the device’s power management from turning off the display.  
This feature is critical for the battery efficiency requirement. The silent video hack keeps the media decoding hardware active, draining power. The Wake Lock API is a system-level signal that is far more efficient. The application must request this lock immediately when the RSVP stream begins and release it when the user pauses or exits the reading view.

## ---

**III. The Signifying Chain: High-Velocity RSVP Engine**

The core of XYZ is the RSVP loop. To push 1,000 words per minute, the application must display approximately 16.6 words per second. This translates to a new word every 60 milliseconds. On a standard 60Hz display, which refreshes every 16.66ms, a single word persists for only 3 to 4 frames. This demands a rendering engine of metronomic precision, where any "jitter" or frame drop disrupts the cognitive intake and breaks the Lacanian "trip" of the ego.

### **3.1 The Delta-Time Accumulator Loop**

The user code repository likely employs standard JavaScript timing functions like setTimeout or setInterval. For high-velocity RSVP, these are inadequate. setTimeout does not guarantee execution at the specified interval; it merely guarantees execution *after* the interval has passed. In a single-threaded JavaScript environment, if the main thread is blocked by garbage collection or UI layout tasks, a 60ms interval might stretch to 70ms or 80ms. At 1,000 wpm, this drift accumulates rapidly, causing the reading speed to fluctuate perceptibly.13  
To achieve the required precision, XYZ must utilize requestAnimationFrame (rAF). This API synchronizes the execution of the render loop with the browser's display refresh rate (VSync). However, simply advancing one word per frame (at 60fps) would result in a speed of 3,600 wpm—too fast even for the unconscious. Therefore, the engine must decouple the *simulation time* (the word stream) from the *render time* (the screen refresh).  
The Accumulator Algorithm:  
Instead of relying on the browser to call the function at specific intervals, the loop tracks the elapsed "wall clock" time and accumulates it.

JavaScript

let lastTime \= performance.now();  
let accumulator \= 0;  
// 1000 wpm \= 60,000 ms / 1000 words \= 60ms per word  
const targetInterval \= 60000 / currentWPM; 

function loop(currentTime) {  
  const deltaTime \= currentTime \- lastTime;  
  lastTime \= currentTime;  
  accumulator \+= deltaTime;

  // If the browser lagged and we have accumulated enough time for multiple words,  
  // we advance the logical state multiple times to catch up.  
  // Ideally, at 1000wpm, we advance 0 or 1 time per frame.  
  while (accumulator \>= targetInterval) {  
    currentWordIndex++;   
    accumulator \-= targetInterval;  
  }  
    
  renderWord(currentWordIndex); // Update the DOM or Canvas  
    
  if (isReading) {  
    requestAnimationFrame(loop);  
  }  
}

This approach ensures that the *average* speed over time remains mathematically perfect. If the phone stutters for 100ms, the accumulator will advance the text by two words immediately in the next frame. While skipping a word visually is not ideal, it is preferable to the text slowing down and allowing the ego to re-engage. The priority is the *velocity of the stream*, not the permanence of any single signifier.

### **3.2 The Optimal Recognition Point (ORP) and the Red Letter**

The "Spritz" methodology relies on centering the word not by its geometric center, but by its **Optimal Recognition Point (ORP)**. This is the specific letter within a word where the eye naturally fixates to process the meaning with the highest efficiency. By aligning the ORP of every word to a fixed focal point (the "Reticle"), the app eliminates the need for saccadic eye movements (the physical scanning from left to right), which are the primary bottleneck in reading speed.15  
ORP Calculation Heuristic:  
The position of the ORP depends on the word length. A standard algorithm used in RSVP research is:

* **Word Length 1**: Index 0 (e.g., "**A**")  
* **Word Length 2-5**: Index 1 (e.g., "T**h**e", "W**i**th")  
* **Word Length 6-9**: Index 2 (e.g., "Sc**h**ool")  
* **Word Length 10-13**: Index 3 (e.g., "Con**s**cious")  
* **Word Length \> 13**: Index 4 (e.g., "Unco**n**scious")

**The Red Letter**: The character at the ORP index is highlighted in red. This serves as the "Object *a*"—the focal point of desire that captures the gaze.  
Centering Logic:  
To align the word, the rendering engine must calculate the pixel width of the "Left Context" (the substring of characters before the ORP).  
Offset \= (ScreenCenterX) \- (Width(LeftContext) \+ Width(ORPCharacter) / 2\)  
For battery efficiency, calculating measureText on a Canvas or querying DOM element widths for every word at 60Hz is expensive.

* **Optimization**: Use a monospaced font (e.g., 'Roboto Mono' or 'Fira Code'). With a monospaced font, the width of the Left Context is simply Index \* CharWidth. This reduces the layout calculation to a basic multiplication, which is negligible for the CPU, preserving battery life for the "long ferry ride."

### **3.3 Battery Efficiency: The Silent DOM**

Manipulating the DOM triggers the browser's layout and paint pipelines, which are energy-intensive. To ensure the "inner word loop needs to be super efficient so it doesnt eat up my phone battery," XYZ should minimize "Layout Thrashing."

* **CSS Containment**: Apply contain: strict; to the container element holding the RSVP word. This informs the browser that changes inside this box do not affect the layout of the rest of the page, allowing it to skip global recalculations.14  
* **Canvas vs. DOM**: While Canvas is faster for raw pixel pushing, a simple text node update inside a contained div is often sufficient for text and handles accessibility better. Given the monochrome nature of the app (High Contrast), the DOM approach with will-change: content is acceptable, provided the surrounding elements are static.

## ---

**IV. The Materiality of the Text: Ingestion and Reconstruction**

The application must ingest "general books" from ZLibrary, primarily in EPUB format, but with a robust fallback for PDF that creates a "high fidelity epub translation." This translation is not merely visual; it is structural. The RSVP engine requires a linear stream of words, meaning the spatial layout of a PDF must be flattened into a temporal sequence.

### **4.1 EPUB: The Central Format**

EPUB is the native tongue of digital reading. It consists of XHTML files wrapped in a Zip container.

* **Library**: epub.js is the standard client-side library for parsing EPUBs.  
* **Extraction**: The app must parse the .opf file to obtain the "spine" (the order of chapters). It then loads each chapter's HTML.  
* **Sanitization**: The extraction process must traverse the DOM, ignoring non-content elements (navigation, page numbers) and extracting text from block-level elements (p, div, h1). Crucially, it must detect the boundaries of these blocks to insert "pause" tokens. In the RSVP stream, the end of a paragraph should induce a pause equivalent to 3-4 words, allowing the reader to cognitively digest the block before the next one begins.

### **4.2 PDF: The Broken Signifier**

PDFs are notoriously resistant to linear reading. They do not contain "text" in the semantic sense; they contain instructions to "draw glyph X at coordinates x,y." A sentence spanning two lines is effectively two disconnect groups of characters.19  
Heuristic Reconstruction Algorithm:  
To create a "high fidelity translation" that preserves paragraphs and reading order, XYZ must employ a spatial heuristic algorithm using pdf.js.22

1. **Extraction**: Use pdf.js to get the TextContent of a page. This returns a flat array of items, each with a string and a transform matrix \`\`.  
2. **Y-Sorting (Line Detection)**: The items must be sorted primarily by their vertical position (Y-coordinate). However, PDF coordinates can be floating-point and slightly jittery. Items are grouped into "Lines" if their Y-coordinates are within a small tolerance (e.g., 20% of the font height).  
3. **X-Sorting (Word Order)**: Within each Line, items are sorted by their X-coordinate to reconstruct the sentence from left to right.  
4. **Paragraph Detection (The Gap in the Real)**: This is the most critical step. The algorithm calculates the vertical distance between the bottom of one line and the top of the next (the "leading").  
   * *Heuristic*: Calculate the mode (most frequent) leading for the page. If the gap between two lines is significantly larger than the mode (e.g., \> 1.5x), insert a **Paragraph Break**.  
   * *Indentation Check*: If a line starts at an X-coordinate significantly to the right of the page's left margin (and previous lines started at the margin), it is likely the start of a new paragraph.  
5. **De-Hyphenation**: If a line ends with a hyphen character (-) and the next line begins with a lowercase letter, the hyphen is stripped and the words are merged (un- \+ conscious \-\> unconscious). If the next line starts with an uppercase letter, the hyphen is likely part of a compound noun and is kept.  
6. **Artifact Removal**: Headers and footers often appear at extreme Y-coordinates and repeat across pages. The ingestion worker should analyze the first 3-5 pages to identify repeating text blocks at the top/bottom margins and exclude them from the RSVP stream.

Web Worker Implementation:  
This reconstruction is computationally expensive. To prevent the UI from freezing (which would crash the "XYZ" experience), the entire parsing and text extraction process must run in a dedicated Web Worker. The Worker accepts the PDF binary, processes it page by page, and returns a clean array of words and pause tokens to the main thread.22

## ---

**V. The Syncopated Subject: Offline-First Data Architecture**

The user requires the app to function across a laptop and a phone, handling "diverged states" gracefully. This implies a distributed system where the "truth" of the reading position is negotiated rather than dictated.

### **5.1 The Database Strategy: RxDB and the CRDT**

To manage the library (metadata, covers, reading progress) and the user's highlights, XYZ requires a robust local database.

* **RxDB (Reactive Database)**: This is the ideal choice. It is a NoSQL-database for JavaScript applications that focuses on offline-first interaction and data sync. It is reactive, meaning the UI updates automatically when data changes.25  
* **CRDTs (Conflict-free Replicated Data Types)**: To handle the scenario where the user reads on the phone (offline) and modifies the library on the laptop (offline), and then syncs later, we utilize CRDTs. A CRDT ensures that all replicas of the data eventually converge to the same state without data loss.  
  * **Yjs**: This is the industry-standard CRDT library for text and state.27  
  * **Integration**: RxDB has a plugin for replication that can work with CRDT principles, or specific fields (like "highlights") can be stored as Yjs documents.

### **5.2 The Architecture of Divergence**

**Scenario**: The user is on a ferry.

* **Phone (Offline)**: User reads *Seminar XI*, advancing from page 50 to 100\. They highlight a passage about "The Gaze."  
* **Laptop (Offline)**: User opens *Seminar XI* to verify a reference. The laptop shows page 50\. The user highlights a different passage about "The Voice."

Scenario: The Return (Sync).  
When the phone and laptop reconnect (via Local LAN or P2P), they exchange "State Vectors."

1. **Reading Position**: This is a "Last-Write-Wins" (LWW) register, but nuanced. We likely want the *furthest* position to win, assuming the user doesn't want to lose progress. Alternatively, we use the timestamp. If the Phone's update (Page 100\) has a later timestamp than the Laptop's last active time, the Laptop updates to Page 100\.  
2. **Highlights**: This is a "Grow-Only Set" (or a map of adds/removes). The CRDT merges the operations. The result is a document that contains *both* the highlight on "The Gaze" (from Phone) and "The Voice" (from Laptop). No conflict error is raised; the divergence is resolved by union.

### **5.3 Topology: The Local Server (The Big Other)**

Since the user wants "no server" in the cloud sense, the Laptop acts as the local anchor.

* **Laptop Mode**: When the app runs on the Laptop, it can spin up a lightweight **WebSocket Server** (using Node.js or within the browser via WebRTC signaling).  
* **Phone Mode**: The Phone attempts to connect to the Laptop's IP address (discovered via mDNS or manual entry).  
* **Protocol**: They communicate via y-websocket. The Phone sends its accumulated updates. The Laptop acknowledges. The state is synchronized. If the Laptop is off, the Phone simply continues to store changes in its local IndexedDB/OPFS.

## ---

**VI. The Analyst: Generative AI and the "Reference" View**

The user wants to "highlight passages and ask what Gemini thinks about it" and use the desktop UI to "reference" the text while reading on the phone.

### **6.1 The Desktop as the "Symbolic"**

While the Phone is the device of the *Real* (raw speed, no context), the Desktop is the device of the *Symbolic* (structure, context, analysis).

* **Real-Time Mirroring**: While reading on the phone, the phone emits its current Word Index via the local WebSocket. The Laptop subscribes to this stream. It updates its view to show the full page, scrolling automatically to keep the currently spoken word in view. This allows the user to glance at the Laptop for the "big picture" without breaking the flow on the phone. This fulfills the requirement to "update the position... so if i do feel like reading a passage slowly... i can easily reference it."



## ---

**VII. The Project Manifest: Implementation Instructions**

The following specification is designed to be ingested by a Coding LLM (e.g., GitHub Copilot) to scaffold the XYZ repository.

### **7.1 Tech Stack & Dependencies**

* **Framework**: React 18+ (Vite)  
* **Language**: TypeScript 5.0+ (Strict Mode)  
* **PWA**: vite-plugin-pwa (Must configure registerType: 'autoUpdate' and manifest for standalone mode).  
* **State Management**:  
  * rxdb: For the document store (Books, Settings).  
  * rxdb/plugins/storage-dexie: For IndexedDB support.  
  * yjs & y-websocket: For synchronization logic.  
* **Parsers**:  
  * pdfjs-dist: For PDF extraction.  
  * epubjs: For EPUB parsing.  
* **UI/Styling**: tailwindcss (Utility-first), framer-motion (for minimal, smooth transitions).  
* **AI**: @google/generative-ai.

### **7.2 Directory Structure**

/src  
  /assets          \# Icons, fonts (Roboto Mono)  
  /components  
    /Reader        \# RSVP View  
      /Reticle.tsx \# The visual focal point (Red Letter)  
      /Canvas.tsx  \# The rAF render loop component  
    /Library       \# Grid view of covers  
    /Analysis      \# Gemini chat interface  
  /core  
    /rsvp  
      engine.ts    \# The Delta-Accumulator Loop and WPM logic  
      orp.ts       \# Algorithm for calculating Optimal Recognition Point  
    /ingest  
      pdf-worker.ts \# Web Worker for PDF heuristic reconstruction  
      epub.ts       \# EPUB parser  
    /sync  
      db.ts        \# RxDB initialization  
      network.ts   \# P2P / WebSocket connection manager  
  /hooks  
    useWakeLock.ts \# Custom hook for Screen Wake Lock API  
    usePersist.ts  \# Custom hook to request storage persistence

### **7.3 Critical Algorithms (Pseudo-Code for LLM)**

**1\. The RSVP Loop (Engine)**

* *Requirement*: Use requestAnimationFrame and performance.now().  
* *Logic*: Maintain a float word index. Increment based on deltaTime \* (wordsPerMs). Math.floor(index) determines the word to render. This handles sub-frame timing precision.

**2\. The PDF Heuristic (Worker)**

* *Input*: Array of TextItems from pdf.js.  
* *Process*:  
  * Sort by Y (descending), then X (ascending).  
  * Calculate avgLineHeight.  
  * Iterate items. If currentY \< prevY \- (avgLineHeight \* 1.5), insert \\n\\n (Paragraph).  
  * Else if currentY \< prevY \- (avgLineHeight \* 0.2), insert (Line break).  
  * Handle hyphenation: If line ends in \-, peek next line. If lowercase, join.

**3\. The Sync Logic**

* *Setup*: Initialize RxDB with multiInstance: true.  
* *Replication*: Create a replication-p2p or custom y-websocket replication state.  
* *Conflict*: Define CRDT fields for reading\_log and highlights.

### **7.4 Manifest.json Configuration**

To satisfy the iOS constraints, the manifest.json must be explicit:

JSON

{  
  "name": "XYZ",  
  "short\_name": "XYZ",  
  "start\_url": "/",  
  "display": "standalone",  
  "background\_color": "\#000000",  
  "theme\_color": "\#000000",  
  "icons": \[  
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },  
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }  
  \]  
}

*Note*: The display: standalone is the trigger for iOS to treat the app as a "Home Screen App" and grant it the separate storage container exempt from the 7-day wipe.

## ---

**VIII. Conclusion**

The construction of XYZ is a traverse through the constraints of the digital ecosystem. By leveraging the **Service Worker** as the "Unconscious" that manages data behind the scenes, and **IndexedDB/OPFS** as the "Symbolic" register of the library, the application establishes a resilient, offline-first existence that defies the "Real" of iOS limitations. The use of **CRDTs** ensures that the subject’s split existence across Phone and Laptop is sutured without loss, while the high-velocity **RSVP Engine**, driven by the metronomic precision of the requestAnimationFrame loop, provides the mechanism to trip the ego and access the raw enjoyment of the text.  
This architecture satisfies every constraint: it bypasses the App Store, functions offline for days, syncs gracefully, consumes universal formats via heuristics, and integrates advanced AI analysis, all while adhering to the Lacanian premise of high-speed traversal. The project is ready for implementation.

#### **Works cited**

1. Storage for the web | Articles \- web.dev, accessed December 23, 2025, [https://web.dev/articles/storage-for-the-web](https://web.dev/articles/storage-for-the-web)  
2. 11 Major Progressive Web App Limitations to iOS Users \- Tigren, accessed December 23, 2025, [https://www.tigren.com/blog/progressive-web-app-limitations/](https://www.tigren.com/blog/progressive-web-app-limitations/)  
3. Does Safari's 7-day eviction policy apply to OPFS (Origin Private File System)?, accessed December 23, 2025, [https://stackoverflow.com/questions/79578280/does-safaris-7-day-eviction-policy-apply-to-opfs-origin-private-file-system](https://stackoverflow.com/questions/79578280/does-safaris-7-day-eviction-policy-apply-to-opfs-origin-private-file-system)  
4. This can't seriously be how Apple's WebKit engine works, right? : r/webdev \- Reddit, accessed December 23, 2025, [https://www.reddit.com/r/webdev/comments/11qalm2/this\_cant\_seriously\_be\_how\_apples\_webkit\_engine/](https://www.reddit.com/r/webdev/comments/11qalm2/this_cant_seriously_be_how_apples_webkit_engine/)  
5. PWA on iOS \- Current Status & Limitations for Users \[2025\] \- Brainhub, accessed December 23, 2025, [https://brainhub.eu/library/pwa-on-ios](https://brainhub.eu/library/pwa-on-ios)  
6. Storage quotas and eviction criteria \- Web APIs \- MDN Web Docs, accessed December 23, 2025, [https://developer.mozilla.org/en-US/docs/Web/API/Storage\_API/Storage\_quotas\_and\_eviction\_criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)  
7. Available storage on mobile device \- General \- SilverBullet Community, accessed December 23, 2025, [https://community.silverbullet.md/t/available-storage-on-mobile-device/2132](https://community.silverbullet.md/t/available-storage-on-mobile-device/2132)  
8. FAQ \- PouchDB, accessed December 23, 2025, [https://pouchdb.com/faq.html](https://pouchdb.com/faq.html)  
9. The Screen Wake Lock API is now supported in all browsers | web.dev, accessed December 23, 2025, [https://web.dev/blog/screen-wake-lock-supported-in-all-browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers)  
10. WakeLock \- Web APIs | MDN, accessed December 23, 2025, [https://developer.mozilla.org/en-US/docs/Web/API/WakeLock](https://developer.mozilla.org/en-US/docs/Web/API/WakeLock)  
11. Screen Wake Lock API | Can I use... Support tables for HTML5, CSS3, etc \- CanIUse, accessed December 23, 2025, [https://caniuse.com/wake-lock](https://caniuse.com/wake-lock)  
12. Screen Wake Lock API Browser Compatibility On Safari \- LambdaTest, accessed December 23, 2025, [https://www.lambdatest.com/web-technologies/wake-lock-safari](https://www.lambdatest.com/web-technologies/wake-lock-safari)  
13. Window: requestAnimationFrame() method \- Web APIs | MDN, accessed December 23, 2025, [https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)  
14. Jank busting for better rendering performance | Articles \- web.dev, accessed December 23, 2025, [https://web.dev/articles/speed-rendering](https://web.dev/articles/speed-rendering)  
15. Rapid serial visual presentation in reading: The case of Spritz | TSW, accessed December 23, 2025, [https://www.tsw.it/wp-content/uploads/Rapid-serial-visual-presentation-in-reading-The-case-of-Spritz-1.pdf](https://www.tsw.it/wp-content/uploads/Rapid-serial-visual-presentation-in-reading-The-case-of-Spritz-1.pdf)  
16. Spritz: The Faster Speed Reader Technique » the nerve blog \- Boston University, accessed December 23, 2025, [https://sites.bu.edu/ombs/2014/03/09/spritz-the-faster-speed-reader-technique/](https://sites.bu.edu/ombs/2014/03/09/spritz-the-faster-speed-reader-technique/)  
17. Optimizing the viewing position of words increases reading speed in patients with central vision loss | IOVS, accessed December 23, 2025, [https://iovs.arvojournals.org/article.aspx?articleid=2331977](https://iovs.arvojournals.org/article.aspx?articleid=2331977)  
18. Spritz \- IndieReader, accessed December 23, 2025, [https://indiereader.com/2014/05/spritz/](https://indiereader.com/2014/05/spritz/)  
19. PDF Text Extraction Library for JavaScript \- Apryse documentation, accessed December 23, 2025, [https://docs.apryse.com/web/guides/features/extraction/text-extract](https://docs.apryse.com/web/guides/features/extraction/text-extract)  
20. Extract text from PDF using JavaScript \- Apryse documentation, accessed December 23, 2025, [https://docs.apryse.com/web/guides/extraction/text-extract](https://docs.apryse.com/web/guides/extraction/text-extract)  
21. Algorithms for extracting lines, paragraphs with their properties in PDF documents, accessed December 23, 2025, [https://www.researchgate.net/publication/371174600\_Algorithms\_for\_extracting\_lines\_paragraphs\_with\_their\_properties\_in\_PDF\_documents](https://www.researchgate.net/publication/371174600_Algorithms_for_extracting_lines_paragraphs_with_their_properties_in_PDF_documents)  
22. How to correctly extract text from a pdf using pdf.js \- Stack Overflow, accessed December 23, 2025, [https://stackoverflow.com/questions/40635979/how-to-correctly-extract-text-from-a-pdf-using-pdf-js](https://stackoverflow.com/questions/40635979/how-to-correctly-extract-text-from-a-pdf-using-pdf-js)  
23. pdfjs: get raw text from pdf with correct newline/withespace \- Stack Overflow, accessed December 23, 2025, [https://stackoverflow.com/questions/54645206/pdfjs-get-raw-text-from-pdf-with-correct-newline-withespace](https://stackoverflow.com/questions/54645206/pdfjs-get-raw-text-from-pdf-with-correct-newline-withespace)  
24. What is the meaning of x/y coordinates in the array items of textContent.items? · Issue \#12031 · mozilla/pdf.js \- GitHub, accessed December 23, 2025, [https://github.com/mozilla/pdf.js/issues/12031](https://github.com/mozilla/pdf.js/issues/12031)  
25. RxDB – The Ultimate Offline Database with Sync and Encryption, accessed December 23, 2025, [https://rxdb.info/articles/offline-database.html](https://rxdb.info/articles/offline-database.html)  
26. Instant Performance with IndexedDB RxStorage | RxDB \- JavaScript Database, accessed December 23, 2025, [https://rxdb.info/rx-storage-indexeddb.html](https://rxdb.info/rx-storage-indexeddb.html)  
27. Yjs | Homepage, accessed December 23, 2025, [https://yjs.dev/](https://yjs.dev/)  
28. yjs/yjs: Shared data types for building collaborative software \- GitHub, accessed December 23, 2025, [https://github.com/yjs/yjs](https://github.com/yjs/yjs)  
29. Cross-origin resource sharing (CORS) | Cloud Storage \- Google Cloud Documentation, accessed December 23, 2025, [https://docs.cloud.google.com/storage/docs/cross-origin](https://docs.cloud.google.com/storage/docs/cross-origin)  
30. How to solve CORS error while fetching an external API? \- Stack Overflow, accessed December 23, 2025, [https://stackoverflow.com/questions/72084470/how-to-solve-cors-error-while-fetching-an-external-api](https://stackoverflow.com/questions/72084470/how-to-solve-cors-error-while-fetching-an-external-api)