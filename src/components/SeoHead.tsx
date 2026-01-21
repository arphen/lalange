import { useEffect } from 'react';

interface SeoHeadProps {
  title: string;
  description?: string;
  canonicalUrl?: string;
  type?: 'website' | 'article';
  schema?: Record<string, unknown>;
}

export const SeoHead = ({ 
  title, 
  description, 
  canonicalUrl,
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

    if (description) {
      updateMeta('description', description);
      updateMeta('og:description', description, 'property');
      updateMeta('twitter:description', description);
    }

    updateMeta('og:title', fullTitle, 'property');
    updateMeta('twitter:title', fullTitle);
    updateMeta('og:type', type, 'property');

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
    
    if (schema) {
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

  }, [title, description, canonicalUrl, type, schema]);

  return null;
};
