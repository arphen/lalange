/**
 * OG Image Generator
 * 
 * Run with: node scripts/generate_og_image.js
 * 
 * This generates the social sharing image for XYZ.
 * Requires: npm install canvas (if you want to run this)
 * 
 * For now, this serves as a specification. You can:
 * 1. Use Figma/Canva to create based on this spec
 * 2. Install canvas and run this script
 * 3. Use an online OG image generator
 * 
 * Image specs:
 * - Size: 1200x630 (standard OG image size)
 * - Format: PNG
 * - Location: public/og-image.png
 */

const SPEC = {
  width: 1200,
  height: 630,
  background: '#0a0a0a',
  
  title: {
    text: 'XYZ',
    color: '#d4af37', // dune-gold
    fontSize: 120,
    y: 200,
  },
  
  subtitle: {
    text: 'AI Speed Reading',
    color: '#ffffff',
    fontSize: 48,
    y: 300,
  },
  
  tagline: {
    text: 'Read 3x faster • 100% private • No login required',
    color: '#888888',
    fontSize: 28,
    y: 380,
  },
  
  features: [
    '🚀 RSVP Technology',
    '🧠 AI-Powered Pacing',
    '🔒 100% Local',
  ],
  
  footer: {
    text: 'xyz.com',
    color: '#d4af37',
    fontSize: 24,
    y: 580,
  },
  
  // Visual elements
  decorations: {
    // Gradient overlay from bottom
    gradient: 'linear-gradient(180deg, transparent 0%, rgba(212,175,55,0.1) 100%)',
    // Subtle grid pattern
    grid: true,
  }
};

console.log('OG Image Specification:');
console.log(JSON.stringify(SPEC, null, 2));
console.log('\nCreate a 1200x630 PNG image with these specs and save to public/og-image.png');

// If canvas is available, generate the image
try {
  const { createCanvas } = require('canvas');
  const fs = require('fs');
  const path = require('path');
  
  const canvas = createCanvas(SPEC.width, SPEC.height);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = SPEC.background;
  ctx.fillRect(0, 0, SPEC.width, SPEC.height);
  
  // Grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < SPEC.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SPEC.height);
    ctx.stroke();
  }
  for (let y = 0; y < SPEC.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SPEC.width, y);
    ctx.stroke();
  }
  
  // Gradient overlay
  const gradient = ctx.createLinearGradient(0, 0, 0, SPEC.height);
  gradient.addColorStop(0, 'transparent');
  gradient.addColorStop(1, 'rgba(212,175,55,0.1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPEC.width, SPEC.height);
  
  // Title
  ctx.fillStyle = SPEC.title.color;
  ctx.font = `bold ${SPEC.title.fontSize}px "Roboto Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(SPEC.title.text, SPEC.width / 2, SPEC.title.y);
  
  // Subtitle
  ctx.fillStyle = SPEC.subtitle.color;
  ctx.font = `${SPEC.subtitle.fontSize}px "Roboto Mono", monospace`;
  ctx.fillText(SPEC.subtitle.text, SPEC.width / 2, SPEC.subtitle.y);
  
  // Tagline
  ctx.fillStyle = SPEC.tagline.color;
  ctx.font = `${SPEC.tagline.fontSize}px "Roboto Mono", monospace`;
  ctx.fillText(SPEC.tagline.text, SPEC.width / 2, SPEC.tagline.y);
  
  // Features
  ctx.font = `${32}px "Roboto Mono", monospace`;
  ctx.fillStyle = '#ffffff';
  const featureY = 460;
  const featureSpacing = 300;
  SPEC.features.forEach((feature, i) => {
    const x = (SPEC.width / 2) - featureSpacing + (i * featureSpacing);
    ctx.fillText(feature, x, featureY);
  });
  
  // Footer
  ctx.fillStyle = SPEC.footer.color;
  ctx.font = `bold ${SPEC.footer.fontSize}px "Roboto Mono", monospace`;
  ctx.fillText(SPEC.footer.text, SPEC.width / 2, SPEC.footer.y);
  
  // Border
  ctx.strokeStyle = SPEC.title.color;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, SPEC.width - 40, SPEC.height - 40);
  
  // Save
  const outputPath = path.join(__dirname, '..', 'public', 'og-image.png');
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`\n✅ OG image saved to: ${outputPath}`);
  
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('\n⚠️  Canvas module not installed. Run: npm install canvas');
    console.log('Or create the image manually using the spec above.');
  } else {
    throw e;
  }
}
