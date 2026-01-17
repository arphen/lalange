Feature Specification: The Velocireader Protocol
1. Overview

    Feature Name: Left-Aligned Monospace RSVP with Luma-Weight Anchoring & Peripheral Notching.

    Core Value: Eliminates the "saccadic exhaustion" of standard RSVP without infringing on "Fixed ORP" patents. It transforms reading into a high-velocity data stream by stabilizing the eye's start position while making the word's center (Optimal Recognition Point) visually irresistible via contrast and shape manipulation.

Target Performance: 600+ WPM with high comprehension and low cognitive load.

2. Functional Requirements
A. The Geometry Engine (The "Grid")

    Font Stack: Must use a Variable Font (e.g., Roboto Flex, Inter Variable) to allow dynamic manipulation of Weight (wght), Width (wdth), and Slant (slnt) axes.

Alignment Strategy:

    Left-Aligned Monospace: Words are rendered in a monospace font, left-aligned to a static coordinate (e.g., x = 20% of screen width).

Quantized Movement: Unlike proportional fonts, monospace ensures the eye's movement is predictable ("linear rule"), reducing "hunting" behavior.

Legal Clearance: Because the Optimal Recognition Point (ORP) physically moves right/left based on word length, this avoids Spritz's "fixed display location" patent claim.

B. The Salience Engine (The "Anchor")

    Objective: Guide the eye to the ORP (processing point) without moving the text.

    Mechanism: Replace "Spatial Anchoring" (Spritz) with Contrast Anchoring.

Algorithm (The Luma-Weight Gradient):

    Identify the ORP index (approx. 35% into the word).

Luminance: Apply a Gaussian gradient. The ORP character is 100% White; characters fade to ~50% Grey as they move away from the center. This triggers the Magnocellular pathway (brightness sensitivity) to reflexively pull the eye.

Weight: The ORP character is Extra-Bold (800); tails fade to Light (300).


Variable Width Expansion:

    ORP: Standard Width (100%).

    Tails: Linearly increase width to 120% as characters move further from the center. This physically separates strokes to counteract retinal smearing.

The "Vortex" Slant:

    Start of Word: Back Slant (-10°) to visually push focus toward the center.

End of Word: Forward Slant (+10°) to lead the eye forward and separate letter corners.
