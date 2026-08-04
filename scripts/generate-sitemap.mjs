import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(projectRoot, 'src/seo/publicRoutes.json');
const sitemapPath = resolve(projectRoot, 'public/sitemap.xml');
const routes = JSON.parse(await readFile(manifestPath, 'utf8'))
    .filter((route) => route.includeInSitemap);

const escapeXml = (value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const entries = routes.map((route) => `  <url>
    <loc>${escapeXml(route.canonicalUrl)}</loc>
    <lastmod>${escapeXml(route.lastmod)}</lastmod>
  </url>`).join('\n');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;

await writeFile(sitemapPath, sitemap, 'utf8');
console.log(`Generated ${sitemapPath} from ${routes.length} public routes`);