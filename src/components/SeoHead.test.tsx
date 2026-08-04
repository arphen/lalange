import { beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SeoHead } from './SeoHead';

describe('SeoHead', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="robots" content="index, follow">
      <meta name="description" content="Public description">
      <meta property="og:url" content="https://arphen.xyz/">
      <meta property="og:image" content="https://arphen.xyz/og-image.png">
      <meta name="twitter:url" content="https://arphen.xyz/">
      <meta name="twitter:image" content="https://arphen.xyz/og-image.png">
      <link rel="canonical" href="https://arphen.xyz/">
    `;
  });

  it('switches metadata between private and public SPA routes', async () => {
    const view = render(
      <SeoHead
        title="Settings"
        description="Private settings"
        robots="noindex, nofollow"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      expect(document.querySelector('link[rel="canonical"]')).not.toBeInTheDocument();
      expect(document.querySelector('meta[property^="og:"]')).not.toBeInTheDocument();
      expect(document.querySelector('meta[name^="twitter:"]')).not.toBeInTheDocument();
    });

    view.rerender(
      <SeoHead
        title="Research"
        description="Public research"
        canonicalUrl="https://arphen.xyz/research"
      />,
    );

    await waitFor(() => {
      expect(document.title).toBe('Research | XYZ');
      expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://arphen.xyz/research');
      expect(document.querySelector('meta[property="og:type"]')).toHaveAttribute('content', 'website');
      expect(document.querySelector('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
    });
  });
});