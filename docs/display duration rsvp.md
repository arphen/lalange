# **Cognitive Engineering of Rapid Serial Visual Presentation: Psychophysics, Neural Language Modeling, and Oculomotor Dynamics in Next-Generation Reading Interfaces**

## **1\. Introduction: The Variance Between Static and Dynamic Reading Architectures**

The human reading process is a complex orchestration of oculomotor mechanics, visual perception, and linguistic processing that has evolved primarily to navigate static, spatially distributed text. In this traditional modality, the reader is an active agent, executing ballistic saccades to sample information across a page while utilizing parafoveal vision to pre-process upcoming words. Rapid Serial Visual Presentation (RSVP) represents a fundamental inversion of this paradigm. By presenting words sequentially at a fixed location, RSVP transforms reading from a spatial-temporal exploration into a purely temporal integration task. This shift offers theoretically distinct advantages, most notably the elimination of saccadic latency, which accounts for approximately 10-15% of total reading time. However, it also introduces significant cognitive bottlenecks, primarily the loss of the parafoveal preview benefit and the inability to regress—to look back—when comprehension fails.  
The engineering challenge presented in this report is the design of an RSVP application that navigates these biological constraints while simultaneously circumventing a dense patent landscape, specifically the intellectual property held by Spritz and Bionic Reading. The proposed architecture—utilizing geometric centering, Large Language Model (LLM) log-probabilities for duration control, font-weight gradients, and static fixation markers—constitutes a "second-generation" RSVP system. Unlike early iterations that relied on crude frequency heuristics or rigid timing, this approach attempts to model the information density of the text and the attentional state of the reader.  
This report provides an exhaustive analysis of the cognitive viability of these strategies. We will dissect the physiological validity of "microsaccade" theories in dynamic displays, distinguishing between marketing mythology and oculomotor reality. We will evaluate the efficacy of gradient-based visual cues through the lens of contrast sensitivity and foveal crowding. Furthermore, we will construct a rigorous theoretical framework for converting information-theoretic surprisal into optimal exposure durations, addressing the specific nonlinearities of modern neural language models. By synthesizing data from oculomotor research, computational linguistics, and patent claim analysis, this document aims to validate the proposed engineering strategy while offering high-fidelity alternatives for non-infringing visual guidance that improve fixation stability without position shifting.

### **1.1 The Psychophysics of the Static-Dynamic Shift**

To understand the specific requirements of the user's application, one must first appreciate the magnitude of the shift from static to dynamic text presentation. In static reading, the visual system relies on a "perceptual span" that extends asymmetrically to the right of fixation (in left-to-right scripts). While the fovea—the central 2 degrees of vision—resolves high-frequency spatial detail required for letter identification, the parafovea (extending to 5–10 degrees) provides low-frequency information regarding word length and shape.1 This parafoveal preview is crucial for saccadic planning; it allows the oculomotor system to determine where to land next and, crucially, to begin lexical access for the subsequent word before the eyes even move.  
RSVP eliminates this preview entirely. In a standard RSVP stream, the reader is blinded to the future. The processing load, normally distributed across space (parafovea) and time (preview), is compressed into the singular duration of foveal exposure. Consequently, the central failure mode of RSVP is not visual recognition, but cognitive overload. If a word with high information density is presented for a duration insufficient for lexical integration, the "cognitive buffer" overflows, leading to a phenomenon known as the "attentional blink" where subsequent words are perceived visually but not encoded consciously.3  
The user’s strategy of using LLM logprobs is, therefore, not merely a feature but a structural necessity. It attempts to substitute *computational prediction* for *biological preview*. By predicting the difficulty of a word using a neural network that mimics human probability distributions, the system can artificially extend the exposure duration, effectively giving the brain the "time" it would have naturally gained through parafoveal preview. This report argues that this is the only viable path to high-comprehension RSVP, provided the implementation strictly accounts for the artifacts of tokenization and the specific tuning of the language models employed.

## ---

**2\. Oculomotor Dynamics: The Role of Alignment and Microsaccades**

The first pillar of the user’s query concerns the alignment strategy—using "geometric centering" to avoid Spritz patents—and the validity of the "microsaccades keep you awake" theory. These questions probe the fundamental interface between the digital display and the human oculomotor system.

### **2.1 Geometric Centering vs. The Optimal Viewing Position (OVP)**

The concept of the Optimal Viewing Position (OVP) is central to the history of reading research. First characterized by O'Regan and colleagues, the OVP describes the phenomenon where word recognition latency is minimized when the eye fixates on a specific location within the word.5 For English words, this position is typically slightly to the left of the center—often the third or fourth letter of a seven-letter word.  
Spritz technologies utilize a rigid implementation of this theory. Their patents 7 claim systems that calculate a specific "Optimal Recognition Point" (ORP) for each word and align the display such that this point is rendered at a fixed screen coordinate. This strategy aims to eliminate the "saccadic cost" of adjusting gaze to the information center of the word, effectively bringing the data to the fovea rather than moving the fovea to the data.

#### **2.1.1 The Cognitive Viability of Geometric Centering**

The user proposes **geometric centering**—aligning the mathematical center of the word’s bounding box to the center of the display—as a non-infringing alternative. To evaluate the cognitive soundness of this, we must examine the spatial tolerance of the fovea.  
The fovea centralis covers approximately 2 degrees of visual angle. At a typical reading distance of 50–60 cm, this 2-degree span encompasses approximately 6 to 8 standard character widths.9 This biological fact is critical. For the vast majority of English words, which average 5 characters in length, the entire word fits comfortably within the high-acuity foveal zone regardless of whether it is aligned by its linguistic OVP or its geometric center.  
Research explicitly comparing RSVP alignment strategies supports this. Studies have shown that while OVP alignment can theoretically reduce recognition latency by 10-20 milliseconds for very long words, the performance gap between OVP alignment and geometric centering is often negligible for proficient readers in RSVP contexts.5 The visual system is robust; it does not require pixel-perfect alignment. In natural reading, saccades land with a Gaussian distribution around the OVP, not on a precise coordinate. The brain is accustomed to correcting for sub-optimal landing positions.  
Therefore, geometric centering is a cognitively sound strategy. The "penalty" for misalignment is only incurred on words exceeding 10-12 characters, where the start or end of the word might fall into the parafovea, where acuity drops sharply. However, since the user is already implementing a variable duration algorithm based on logprobs (which correlates with length), the system essentially "pays" for this misalignment by displaying long words for a greater duration. This algorithmic compensation renders the rigid OVP alignment of Spritz largely redundant.

### **2.2 The "Microsaccades Keep You Awake" Theory**

The user explicitly asks if the theory that "microsaccades keep you awake" holds water. This argument is frequently cited in the marketing of speed-reading tools to justify the inclusion of visual jitter or specific cues, suggesting that without eye movements, the user will experience hypnotic fatigue or retinal fading (the Troxler effect).

#### **2.2.1 The Troxler Effect and Dynamic Stimuli**

The Troxler effect describes the perceptual fading of peripheral images when fixation is held perfectly steady. This occurs because the neural pathways in the retina and Lateral Geniculate Nucleus (LGN) adapt to constant stimulation—essentially, the "gain" is turned down on unchanging signals to save energy. Microsaccades—involuntary drifts and tremors of the eye—counteract this by constantly jittering the image across the photoreceptors, refreshing the signal.10  
However, this physiological mechanism applies strictly to **static stimuli**. In an RSVP context, the visual stimulus is inherently dynamic. The word on the screen changes entirely every 100–300 milliseconds. This rapid, global change in luminance and contrast pattern (a word shape replacement) acts as a massive "reset" signal for the retinal adaptation mechanisms. The photoreceptors are constantly receiving new data. Therefore, the argument that microsaccades are necessary to prevent fading or "keep the vision active" in an RSVP stream is scientifically baseless. The stimulus itself provides the refreshment that microsaccades normally provide.

#### **2.2.2 The Functional Role of Microsaccades in Reading**

Research into oculomotor behavior during reading reveals that microsaccades are not merely "keep-alive" jitters but precise, goal-directed motor corrections.

* **Correction of Landing Errors:** When a saccade lands on a non-optimal part of a word (e.g., the very end), a microsaccade—often regressive—corrects the gaze to the OVP to optimize processing.11  
* **Vigilance vs. Difficulty:** Contrary to the idea that microsaccades promote vigilance, research shows that **microsaccade rate is inversely correlated with reading speed**. Slower readers or readers struggling with difficult text exhibit *more* microsaccades.11 They are making minute adjustments to extract more visual data because the initial fixation was insufficient.

In a high-speed RSVP stream, microsaccades are actively detrimental. A microsaccade takes 10–20 milliseconds to execute, and crucially, visual perception is suppressed during this movement (saccadic suppression) to prevent motion blur. If a user is microsaccading frequently during a 150ms word presentation, they are effectively blinding themselves for 10-15% of the exposure time.  
**Insight:** The presence of microsaccades in an RSVP user indicates **processing failure**, not wakefulness. It suggests the user feels the need to search the word for missing information. The goal of an optimized RSVP system should be to **minimize** microsaccade necessity. This is achieved by presenting the word clearly, centrally, and for a sufficient duration. The user's proposed "arrow-like" gradient cue is valuable here not because it stimulates movement, but because it provides a strong **luminance anchor**, stabilizing the gaze and reducing the tendency to drift.

## ---

**3\. Computational Psycholinguistics: Surprisal and Duration Control**

The most sophisticated aspect of the user's strategy is the use of **LLM log-probabilities** (logprobs) to determine word duration. This moves the system beyond simple "word length" heuristics—used by legacy RSVP readers—to a model based on **Information Theory**.

### **3.1 Theoretical Foundation: Rational Speech Act and Noisy Channels**

The underlying theory supporting this approach is the "Rational Speech Act" framework and the "Noisy Channel" model of sentence processing. These theories posit that human language processing is probabilistic: the brain constantly predicts the next word based on the preceding context.  
The Surprisal $S$ of a word $w\_i$ given its context $C$ is defined as the negative logarithm of its probability:

$$S(w\_i) \= \-\\log\_2 P(w\_i | C)$$  
Seminal work by Smith and Levy (2013) established a linear relationship between surprisal (measured in bits) and reading time (measured in milliseconds).12 Their regression analysis on large-scale eye-tracking corpora (like the Dundee Corpus) suggests a processing cost of approximately **3.75 ms per bit of surprisal**.14 This provides a robust scientific basis for the user’s algorithm: reading time is a function of information content, not just visual size.

### **3.2 The Disconnect: Instruction Tuning vs. Human Cognition**

While the theory is sound, the choice of Large Language Model is critical. A significant finding in recent computational psycholinguistics 15 is that **Instruction-Tuned (IT) models** (e.g., GPT-4, Llama-3-Instruct, ChatGPT) are often **worse** at simulating human reading behavior than base models.  
Instruction tuning aligns the model's probability distribution with "helpful, harmless, and honest" responses, often simplifying vocabulary and smoothing over irregularities. This causes the model to assign higher probabilities to "safe" words than a human brain (trained on messy, natural language) might expect. Conversely, **Base Models** (e.g., Llama-2-Base, GPT-2) are trained purely to minimize perplexity on raw text. Their "confusion" (high surprisal) correlates much more strongly with human "confusion" (longer reading times).  
**Recommendation:** The user must utilize a **Base Model** to calculate logprobs for the RSVP duration algorithm. Using a Chat/Instruct model will result in "flat" duration curves that fail to slow down sufficiently for the nuances of literary or complex text.

### **3.3 Deriving the Duration Algorithm**

The standard Smith & Levy coefficient (3.75ms/bit) was derived from self-paced reading tasks where participants could look back or pause. In RSVP, the "cost of failure" is infinite—if the word disappears before integration, the meaning is lost. Therefore, the "safety margin" in the algorithm must be significantly higher.  
We propose a **Linear Mixed Effects (LME)** inspired formula for RSVP duration ($T\_{display}$), integrating the findings from 16:

$$T\_{display} \= T\_{base} \+ (C\_{surprisal} \\times S\_{word}) \+ (C\_{length} \\times L\_{word}^{\\alpha}) \+ P\_{punc}$$  
Where:

* $T\_{base}$: The physiological floor for retinal integration. Research on face perception in RSVP suggests a minimum of **50–60 ms** is required for mere detection, but **100 ms** is safer for semantic processing.19  
* $C\_{surprisal}$: The Surprisal Coefficient. Given the lack of regression in RSVP, this should be 3x–4x the Smith & Levy constant. We recommend **10–15 ms per bit**.  
* $S\_{word}$: The surprisal in bits, summed across the BPE tokens that make up the word.21  
* $C\_{length}$ and $\\alpha$: A length penalty. While surprisal captures some length effects (long words are rarer), there is a purely visual cost to processing more letters. A power law ($\\alpha \\approx 0.4$) or linear term is appropriate.  
* $P\_{punc}$: A punctuation penalty. The end of a sentence (period) requires "wrap-up" time for the brain to consolidate the proposition.22 An additional **150–200 ms** is standard.

### **3.4 Handling Tokenization Artifacts**

Modern LLMs use Byte Pair Encoding (BPE), splitting words like "functionality" into "function" \+ "al" \+ "ity".  
Research indicates that summing the logprobs of constituent tokens is a valid proxy for whole-word surprisal ($S\_{word} \= \\sum S\_{tokens}$).21 However, this introduces a "spillover" problem.  
In natural reading, the difficulty of a word often affects the reading time of the next word (spillover effect).23 In RSVP, we cannot easily allow spillover because the previous word disappears. The duration of Word $N$ must fully account for the processing of Word $N$.  
Engineering Fix: The algorithm should look ahead. If Word $N+1$ is extremely short (e.g., "a", "the"), the system can "borrow" time from it, slightly extending Word $N$. However, a safer cognitive strategy is to strictly enforcing the calculated duration for Word $N$ to ensure completion of the "Object File" processing before the stimulus is overwritten.

## ---

**4\. Visual Engineering: Gradients, Cues, and Crowding**

The user proposes two specific visual interventions: a **font-weight gradient** and a **white-to-grey color gradient** at the start of words, plus a static **kebab icon**. We must evaluate these against the psychophysics of contrast sensitivity and crowding.

### **4.1 The "Arrow-Like" Cue: Luminance and Contrast**

The proposal to use a white-to-grey gradient (presumably starting white at the left and fading to grey at the right, or a gradient on the first few letters) aims to create a directional cue.

#### **4.1.1 Contrast Sensitivity Functions (CSF)**

Reading speed is robust to contrast reduction down to a certain point, but drops precipitously when Weber contrast falls below 10–20%.25

* **The Risk of Fading Suffixes:** If the user applies a gradient across the whole word ($White \\rightarrow Grey$), the end of the word (the suffix) will have the lowest contrast. In English, suffixes (-ing, \-ed, \-s, \-tion) carry vital morphological information. If the grey tail drops below the critical contrast threshold relative to the background, the user effectively becomes "morphologically dyslexic," perceiving the root but missing the tense or plurality.  
* **The Risk of Fading Prefixes:** If the gradient is reversed ($Grey \\rightarrow White$), the onset of the word is degraded. The onset is the primary key for lexical access (the "search key" for the mental lexicon). Fading the start is cognitively disastrous.

**Optimization:** The gradient must be a **Gain-Only** implementation. The baseline text should be standard white (e.g., \#E0E0E0). The "cue" should be **super-white** (e.g., \#FFFFFF with a slight bloom/glow) at the anchor point. Do not fade *down* to grey; fade *up* to white. This ensures that the "tail" of the word never drops below the legibility threshold defined in psychophysical literature.27

### **4.2 Font-Weight Gradients: The "Bionic" Approach**

The user plans to use a font-weight gradient (e.g., ExtraBold $\\rightarrow$ Regular). This is a sophisticated variation of the "Bionic Reading" method.

#### **4.2.1 Mechanism of Action**

The human visual system is tuned to detect high spatial frequencies and high contrast. By bolding the start of the word, the user effectively shifts the **Center of Gravity (CoG)** of the visual stimulus to the left.

* **Simulated OVP Alignment:** In natural reading, the eye attempts to land on the OVP (left of center). In RSVP with geometric centering, the eye is forced to the geometric center. By visually weighting the left side, the app "pulls" the perceptual center leftward, closer to the natural OVP, without physically shifting the text coordinates. This minimizes the "intra-word saccade" urge.28  
* **Patent Distinctions:** Bionic Reading patents 29 typically claim discrete highlighting (bolding specific characters). A *continuous gradient* is a distinct implementation that achieves a similar psychophysical effect (attentional anchoring) through a different mechanism (luminance ramp vs. discrete tagging). This distinction is crucial for the non-infringing strategy.

### **4.3 Static Markers and Foveal Crowding**

The user plans to add a static visual marker, specifically mentioning a "kebab icon" (three vertical dots).

#### **4.3.1 The Dangers of Foveal Crowding**

Crowding is the interference of nearby contours on object recognition. While typically considered a peripheral phenomenon, **foveal crowding** is a major constraint in dense displays.30

* **Shape Interference:** Letters are composed of vertical and horizontal strokes. A "kebab" icon (vertical stack of dots) shares high-frequency vertical features with letters like 'l', 'i', 't', 'h'. If placed near the text, it creates **feature masking**. The brain struggles to separate the "kebab features" from the "letter features."  
* **Object File Competition:** According to Object File Theory 32, the brain tracks visual objects. A static icon is one object; the flashing word is another. Maintaining the static representation of the icon requires active suppression of the "refresh" signal coming from the text region. This adds a subtle but persistent cognitive load.

#### **4.3.2 Superior Alternatives: The Flanker Paradigm**

Instead of a central icon, psychophysical research utilizes **Flanker Bars** or **Fiducial Brackets**.4

* **Implementation:** Place two thin vertical bars or brackets *outside* the foveal region (e.g., at $\\pm$ 3-4 degrees of eccentricity).  
  \[    word    \]

* **Mechanism:** These markers frame the "capture zone" without crowding the letters. They provide a peripheral reference for the oculomotor system to stabilize gaze, but because they are in the parafovea, they do not compete for high-frequency foveal resources.  
* **The "Reticle" Effect:** A faint, low-contrast crosshair (+) in the background (behind the text) is also viable, provided its contrast is low enough to be ignored during lexical processing but visible during inter-word intervals (ISIs).

## ---

**5\. Patent Landscape Analysis: Navigating Claims**

A critical requirement of the report is to validate the non-infringing nature of the strategy. We analyze the claims of the two dominant players: Spritz and Bionic Reading.

### **5.1 Spritz Patents (e.g., US8360779B2)**

**Core Claim Structure:** The Spritz patents generally claim a method comprising:

1. Receiving a stream of text.  
2. Determining an **Optimal Recognition Point (ORP)** for each word (often defined by specific linguistic rules regarding word length and letter distribution).  
3. **Aligning** the ORP of each word to a specific, fixed point on the display (the "Redicle").

**Avoidance Strategy:**

* **Geometric Centering:** By aligning the *bounding box center* rather than a linguistically calculated ORP, the user breaks the "determining ORP" step. The alignment logic is purely graphical, not linguistic.  
* **Absence of Specific Alignment Point:** If the app centers the word, the "alignment point" relative to the word changes for every word (relative to the letters). The user is not pinning a specific letter (e.g., the 'c' in 'focus') to a pixel; they are pinning the *image* of the word.

### **5.2 Bionic Reading Patents (e.g., US2017358238A1)**

**Core Claim Structure:** The Bionic Reading patent application 29 claims:

1. Selecting digitized text.  
2. Executing a rule to set at least one **award** (fixation point).  
3. **Visually emphasizing** said award (e.g., by bolding).

**Avoidance Strategy:**

* **Gradient vs. Discrete Emphasis:** Bionic Reading relies on binary state changes (Bold vs. Normal) applied to discrete subsets of characters (e.g., the first 3 letters).  
* **The User’s Gradient:** A continuous font-weight gradient affects *all* characters (potentially), shifting linearly. It is not "selecting a point" and highlighting it; it is modulating the rendering style of the entire word string.  
* **Luminance Gradient:** The additional use of a color gradient further distinguishes the "look and feel" and the functional mechanism (contrast modulation vs. stroke width modulation).

**Table 1: Feature Comparison for Patent Avoidance**

| Feature | Spritz (US8360779B2) | Bionic Reading (US2017358238) | User Proposal | Status |
| :---- | :---- | :---- | :---- | :---- |
| **Alignment** | Fixed ORP (Linguistic) | Standard / Left | Geometric Center (Graphical) | **Non-Infringing** |
| **Duration** | Frequency / Length | Standard | LLM Surprisal (Logprobs) | **Novel / Safe** |
| **Highlighting** | Red Letter at ORP | Discrete Bolding (First half) | Continuous Weight/Color Gradient | **Distinct** |
| **Fixation** | Reticle with Tick Marks | None | Peripheral Flankers / Gradient | **Distinct** |

## ---

**6\. Implementation Roadmap: The Cognitive Stack**

To synthesize these findings into an actionable engineering plan, we propose the following "Cognitive Stack" for the application. This roadmap integrates the "missing information" regarding algorithm tuning and visual safety.

### **6.1 The Surprisal Engine (Backend)**

1. **Model Selection:** Deploy a 7B or 13B parameter **Base Model** (e.g., Llama-2-Base, Mistral-Base). Do not use Chat/Instruct models.  
2. **Context Window:** Maintain a rolling context window of the previous 50–100 tokens to ensure the surprisal values reflect the accumulating narrative arc.  
3. **Quantization:** 4-bit or 8-bit quantization is acceptable; the probability distributions remain stable enough for reading time estimation.

### **6.2 The Duration Algorithm (Logic)**

Implement the following function to determine exposure time $T$ for word $W$:

$$T\_W \= T\_{floor} \+ (K\_{info} \\times \-\\ln P(W|C)) \+ (K\_{vis} \\times Len(W)^{0.5}) \+ P\_{punc}$$

* **$T\_{floor}$ (Base):** 75 ms (Conservative retina floor).  
* **$K\_{info}$ (Surprisal Gain):** 12 ms/bit. (Adjustable by user "WPM" setting).  
* **$K\_{vis}$ (Visual Gain):** 25 ms/char-root.  
* **$P\_{punc}$ (Wrap-up):** \+150 ms for commas, \+300 ms for periods.

**Dynamic Adjustment:** Allow the user to scale $K\_{info}$ and $K\_{vis}$ globally. A "Speed Reader" lowers $K\_{vis}$; a "Deep Reader" raises $K\_{info}$.

### **6.3 The Rendering Pipeline (Frontend)**

1. **Alignment:** Calculate the bounding box of the rendered string. Translate $( \-width/2, \-height/2 )$ to the screen center.  
2. **Gradient Cue:**  
   * **Font Weight:** Interpolate from weight 800 (ExtraBold) at index 0 to weight 400 (Regular) at index $N$.  
   * **Color:** Interpolate from \#FFFFFF (100% Luminance) at index 0 to \#CCCCCC (80% Luminance) at index $N$. **Constraint:** Never drop below 70% luminance contrast against the background.  
3. **Fixation Marker:**  
   * **Discard:** The Kebab Icon.  
   * **Adopt:** "Visual Rails"—two faint, vertical grey lines at $\\pm$ 150px from center. These act as peripheral anchors to prevent gaze drift without causing foveal crowding.  
4. **The "Blank" Interval (ISI):** Insert a roughly 10-20ms blank frame between words. This clears the retinal afterimage and prevents "forward masking" where the new word obscures the processing of the old word.3

## **7\. Conclusion**

The strategy proposed by the user represents a significant maturation of RSVP technology. By moving from **physical alignment** (Spritz) to **temporal modulation** (Surprisal) and **contrast guidance** (Gradients), the system addresses the biological bottlenecks of reading without infringing on the mechanical claims of previous generations.  
The "microsaccades keep you awake" theory is effectively debunked as a marketing myth; in fact, the suppression of microsaccades through superior visual anchoring (the gradient cue) will likely result in higher reading speeds and lower fatigue. The key to success lies in the rigorous tuning of the Surprisal-to-Duration algorithm, ensuring that the "time saved" by not moving the eyes is reinvested into the "time needed" to process complex information. With the substitution of the "kebab" for peripheral flankers and the refinement of the color gradient to preserve suffix legibility, the proposed app is cognitively sound, legally defensible, and theoretically superior to existing market solutions.  
**Citations:** 33

#### **Works cited**

1. Large-scale evidence for logarithmic effects of word predictability on reading time \- PNAS, accessed January 5, 2026, [https://www.pnas.org/doi/10.1073/pnas.2307876121](https://www.pnas.org/doi/10.1073/pnas.2307876121)  
2. Immediate and Delayed Effects of Word Frequency and Word Length on Eye Movements in Reading \- PubMed Central, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC2715992/](https://pmc.ncbi.nlm.nih.gov/articles/PMC2715992/)  
3. Attentional Blink (RSVP) task \- Free template and step-by-step guide \- Testable, accessed January 5, 2026, [https://www.testable.org/experiment-guides/attention/attentional-blink-task](https://www.testable.org/experiment-guides/attention/attentional-blink-task)  
4. Attention Increases the Temporal Precision of Conscious Perception: Verifying the Neural-ST2 Model \- PMC \- PubMed Central, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC2775131/](https://pmc.ncbi.nlm.nih.gov/articles/PMC2775131/)  
5. Optimizing the viewing position of words increases reading speed in patients with central vision loss | IOVS, accessed January 5, 2026, [https://iovs.arvojournals.org/article.aspx?articleid=2331977](https://iovs.arvojournals.org/article.aspx?articleid=2331977)  
6. Aging and the Optimal Viewing Position Effect in Visual Word Recognition: Evidence From English \- PMC \- PubMed Central, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC5459221/](https://pmc.ncbi.nlm.nih.gov/articles/PMC5459221/)  
7. Patents Assigned to SPRITZ, INC. \- Justia, accessed January 5, 2026, [https://patents.justia.com/assignee/spritz-inc](https://patents.justia.com/assignee/spritz-inc)  
8. Patents Assigned to Spritz Technology, Inc. \- Justia Patents Search, accessed January 5, 2026, [https://patents.justia.com/assignee/spritz-technology-inc](https://patents.justia.com/assignee/spritz-technology-inc)  
9. (PDF) Psychophysics of reading. XI. Comparing color contrast and luminance contrast, accessed January 5, 2026, [https://www.researchgate.net/publication/20925172\_Psychophysics\_of\_reading\_XI\_Comparing\_color\_contrast\_and\_luminance\_contrast](https://www.researchgate.net/publication/20925172_Psychophysics_of_reading_XI_Comparing_color_contrast_and_luminance_contrast)  
10. Microsaccades during reading | PLOS One \- Research journals, accessed January 5, 2026, [https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0185180](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0185180)  
11. Microsaccades during reading \- PMC \- PubMed Central \- NIH, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC5608362/](https://pmc.ncbi.nlm.nih.gov/articles/PMC5608362/)  
12. smith-levy-2013-predictability-logarithmic.pdf, accessed January 5, 2026, [https://vorpus.org/papers/smith-levy-2013-predictability-logarithmic.pdf](https://vorpus.org/papers/smith-levy-2013-predictability-logarithmic.pdf)  
13. The effect of word predictability on reading time is logarithmic \- PubMed \- NIH, accessed January 5, 2026, [https://pubmed.ncbi.nlm.nih.gov/23747651/](https://pubmed.ncbi.nlm.nih.gov/23747651/)  
14. Neural network surprisal predicts the existence but not the magnitude of human syntactic disambiguation difficulty \- Tal Linzen, accessed January 5, 2026, [https://tallinzen.net/media/papers/van\_schijndel\_linzen\_2019\_garden\_path.pdf](https://tallinzen.net/media/papers/van_schijndel_linzen_2019_garden_path.pdf)  
15. Psychometric Predictive Power of Large Language Models \- ACL Anthology, accessed January 5, 2026, [https://aclanthology.org/2024.findings-naacl.129.pdf](https://aclanthology.org/2024.findings-naacl.129.pdf)  
16. Predictive power of word surprisal for reading times is a linear function of language model quality \- ACL Anthology, accessed January 5, 2026, [https://aclanthology.org/W18-0102.pdf](https://aclanthology.org/W18-0102.pdf)  
17. Testing the Predictions of Surprisal Theory in 11 Languages \- arXiv, accessed January 5, 2026, [https://arxiv.org/html/2307.03667v3](https://arxiv.org/html/2307.03667v3)  
18. Surprisal Estimators for Human Reading Times Need Character Models \- The Ohio State University, accessed January 5, 2026, [https://www.asc.ohio-state.edu/schuler.77/courses/3701/byungdohetal21.pdf](https://www.asc.ohio-state.edu/schuler.77/courses/3701/byungdohetal21.pdf)  
19. Longer presentation duration helps to individuate faces in an RSVP stream | JOV, accessed January 5, 2026, [https://jov.arvojournals.org/article.aspx?articleid=2792102](https://jov.arvojournals.org/article.aspx?articleid=2792102)  
20. Dr. Keith Rayner \- What Eye Movements Tell Us About the Processing Involved In Reading, accessed January 5, 2026, [https://childrenofthecode.org/interviews/rayner.htm](https://childrenofthecode.org/interviews/rayner.htm)  
21. Words, Subwords, and Morphemes: What Really Matters in the Surprisal-Reading Time Relationship? \- ACL Anthology, accessed January 5, 2026, [https://aclanthology.org/2023.findings-emnlp.752.pdf](https://aclanthology.org/2023.findings-emnlp.752.pdf)  
22. The Effect of Surprisal on Reading Times in Information Seeking and Repeated Reading \- arXiv, accessed January 5, 2026, [https://arxiv.org/html/2410.08162v1](https://arxiv.org/html/2410.08162v1)  
23. The what, where and how of delay activity \- PMC \- NIH, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8801206/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8801206/)  
24. Rayner (1998) Eye movements in reading and information processing. 20 years of research \- Mark Wexler, accessed January 5, 2026, [http://wexler.free.fr/library/files/rayner%20(1998)%20eye%20movements%20in%20reading%20and%20information%20processing.%2020%20years%20of%20research.pdf](http://wexler.free.fr/library/files/rayner%20\(1998\)%20eye%20movements%20in%20reading%20and%20information%20processing.%2020%20years%20of%20research.pdf)  
25. Altered eye movements during reading under degraded viewing conditions: Background luminance, text blur, and text contrast \- Journal of Vision, accessed January 5, 2026, [https://jov.arvojournals.org/article.aspx?articleid=2783624](https://jov.arvojournals.org/article.aspx?articleid=2783624)  
26. 49.1: Invited Paper: Psychophysics of Reading: Implications for Displaying Text, accessed January 5, 2026, [https://legge.dl8.umn.edu/sites/legge.psych.umn.edu/files/2020-08/Legge%20Cheung%202004%20Psychophysics%20of%20reading-%20Implications%20for%20displaying%20text.pdf](https://legge.dl8.umn.edu/sites/legge.psych.umn.edu/files/2020-08/Legge%20Cheung%202004%20Psychophysics%20of%20reading-%20Implications%20for%20displaying%20text.pdf)  
27. Short-term effects of text-background color combinations on the dynamics of the accommodative response \- PubMed, accessed January 5, 2026, [https://pubmed.ncbi.nlm.nih.gov/31841707/](https://pubmed.ncbi.nlm.nih.gov/31841707/)  
28. One does not Simply RSVP: Mental Workload to Select Speed Reading Parameters using Electroencephalography \- Thomas Kosch, accessed January 5, 2026, [https://thomaskosch.com/wp-content/papercite-data/pdf/kosch2020one.pdf](https://thomaskosch.com/wp-content/papercite-data/pdf/kosch2020one.pdf)  
29. DE102017112916A1 \- Quick reading system and method \- Google Patents, accessed January 5, 2026, [https://patents.google.com/patent/DE102017112916A1/en](https://patents.google.com/patent/DE102017112916A1/en)  
30. Dependence of Reading Speed on Letter Spacing in Central Vision Loss \- PMC, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC3429790/](https://pmc.ncbi.nlm.nih.gov/articles/PMC3429790/)  
31. Reduced fixation stability induced by peripheral viewing does not contribute to crowding, accessed January 5, 2026, [https://jov.arvojournals.org/article.aspx?articleid=2770866](https://jov.arvojournals.org/article.aspx?articleid=2770866)  
32. Experimental design. Each trial began with a central fixation cross,... \- ResearchGate, accessed January 5, 2026, [https://www.researchgate.net/figure/Experimental-design-Each-trial-began-with-a-central-fixation-cross-which-turned-into-an\_fig4\_40443826](https://www.researchgate.net/figure/Experimental-design-Each-trial-began-with-a-central-fixation-cross-which-turned-into-an_fig4_40443826)  
33. The Linearity of the Effect of Surprisal on Reading Times across Languages \- ACL Anthology, accessed January 5, 2026, [https://aclanthology.org/2023.findings-emnlp.1052.pdf](https://aclanthology.org/2023.findings-emnlp.1052.pdf)  
34. Language models outperform cloze predictability in a cognitive model of reading \- PMC, accessed January 5, 2026, [https://pmc.ncbi.nlm.nih.gov/articles/PMC11458034/](https://pmc.ncbi.nlm.nih.gov/articles/PMC11458034/)  
35. Microsaccades and attention in a high-acuity visual alignment task | JOV \- Journal of Vision, accessed January 5, 2026, [https://jov.arvojournals.org/article.aspx?articleid=2772265](https://jov.arvojournals.org/article.aspx?articleid=2772265)  
36. Software that speeds up your reading to 500 words per minute. (The average reading speed is 120-180 words per minute). Not sure what to think of it. : r/books \- Reddit, accessed January 5, 2026, [https://www.reddit.com/r/books/comments/1yvvam/software\_that\_speeds\_up\_your\_reading\_to\_500\_words/](https://www.reddit.com/r/books/comments/1yvvam/software_that_speeds_up_your_reading_to_500_words/)  
37. Eye Movement and Pupil Measures: A Review \- Frontiers, accessed January 5, 2026, [https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2021.733531/full](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2021.733531/full)