import { useEffect } from 'react';

interface SeoHeadProps {
  title: string;
  description?: string;
  canonicalUrl?: string;
  openGraphImage?: string;
  robots?: 'index, follow' | 'noindex, nofollow';
  type?: 'website' | 'article';
  schema?: Record<string, unknown>;
}

export const SeoHead = ({ 
  title, 
  description, 
  canonicalUrl,
  openGraphImage,
  robots = 'index, follow',
  type = 'website',
  schema
}: SeoHeadProps) => {
  useEffect(() => {
    // strict title template
    const siteName = 'XYZ';
    const fullTitle = title === siteName ? title : `${title} | ${siteName}`;
    
    document.title = fullTitle;

    // Update meta tags
    const updateMeta = (name: string, content: string, attribute = 'name') => {
      let element = document.querySelector(`meta[${attribute}="${name}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    const removeMeta = (name: string, attribute = 'name') => {
      document.querySelector(`meta[${attribute}="${name}"]`)?.remove();
    };

    updateMeta('robots', robots);
    if (description) {
      updateMeta('description', description);
    } else {
      removeMeta('description');
    }

    if (robots === 'noindex, nofollow') {
      document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach((element) => element.remove());
    } else {
      updateMeta('og:title', fullTitle, 'property');
      updateMeta('twitter:title', fullTitle);
      updateMeta('og:type', type, 'property');
      updateMeta('og:site_name', 'XYZ', 'property');
      updateMeta('og:locale', 'en_US', 'property');
      updateMeta('twitter:card', openGraphImage ? 'summary_large_image' : 'summary');

      if (description) {
        updateMeta('og:description', description, 'property');
        updateMeta('twitter:description', description);
      }
      if (canonicalUrl) {
        updateMeta('og:url', canonicalUrl, 'property');
        updateMeta('twitter:url', canonicalUrl);
      }
      if (openGraphImage) {
        updateMeta('og:image', openGraphImage, 'property');
        updateMeta('og:image:width', '1200', 'property');
        updateMeta('og:image:height', '630', 'property');
        updateMeta('twitter:image', openGraphImage);
      }
    }

    // Update Canonical
    let link = document.querySelector('link[rel="canonical"]');
    if (canonicalUrl) {
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', canonicalUrl);
    } else if (link) {
      link.remove();
    }

    // Update JSON-LD Schema
    const schemaId = 'seo-schema-json-ld';
    let script = document.getElementById(schemaId) as HTMLScriptElement;
    
    if (schema && robots === 'index, follow') {
      if (!script) {
        script = document.createElement('script');
        script.id = schemaId;
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.text = JSON.stringify(schema);
    } else if (script) {
      script.remove();
    }

  }, [title, description, canonicalUrl, openGraphImage, robots, type, schema]);

  return null;
};
