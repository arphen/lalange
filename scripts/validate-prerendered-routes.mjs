import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { load } from 'cheerio';

const distDirectory = resolve(process.cwd(), 'dist');
const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'src/seo/publicRoutes.json'), 'utf8'))
    .filter((route) => route.includeInSitemap);
const sitemap = await readFile(resolve(process.cwd(), 'public/sitemap.xml'), 'utf8');
const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expectedLocations = manifest.map((route) => route.canonicalUrl);

if (JSON.stringify(sitemapLocations) !== JSON.stringify(expectedLocations)) {
    throw new Error('Sitemap does not match the public route manifest');
}

const expectedHeadings = {
    '/': 'ARCHIVE',
    '/manifesto': 'MANIFESTO',
    '/research': 'Arphen: The Neuro-Semantic Scansion Engine',
    '/manual': 'Field Manual Pilot Training',
};
const renderedPages = [];

for (const route of manifest) {
    const outputPath = route.pathname === '/'
        ? resolve(distDirectory, 'index.html')
        : resolve(distDirectory, `${route.pathname.slice(1)}.html`);
    const html = await readFile(outputPath, 'utf8');
    const document = load(html);
    const title = document('title').text();
    const description = document('meta[name="description"]').attr('content');
    const canonical = document('link[rel="canonical"]').attr('href');
    const heading = document('h1').first().text().replace(/\s+/g, ' ').trim();
    const expectedTitle = `${route.title} | XYZ`;
    const expectedOpenGraphType = route.contentType === 'WebApplication' ? 'website' : 'article';

    if (
        document('title').length !== 1
        || title !== expectedTitle
        || description !== route.description
        || document('link[rel="canonical"]').length !== 1
        || canonical !== route.canonicalUrl
        || document('meta[name="robots"]').attr('content') !== 'index, follow'
    ) {
        throw new Error(`Invalid metadata in ${route.pathname}`);
    }
    if (document('h1').length !== 1 || heading !== expectedHeadings[route.pathname]) {
        throw new Error(`Heading mismatch in ${route.pathname}: ${heading}`);
    }
    if (document('#root').text().replace(/\s+/g, ' ').trim().length < 100) {
        throw new Error(`Insufficient rendered body content in ${route.pathname}`);
    }
    if (route.pathname === '/research' && !document('#root').text().includes('5.2 SponsorLink Logic')) {
        throw new Error('Prerendered research page is missing inactive panel content');
    }
    if (
        document('meta[property="og:title"]').attr('content') !== expectedTitle
        || document('meta[property="og:description"]').attr('content') !== route.description
        || document('meta[property="og:url"]').attr('content') !== route.canonicalUrl
        || document('meta[property="og:type"]').attr('content') !== expectedOpenGraphType
        || document('meta[property="og:image"]').attr('content') !== route.openGraphImage
        || document('meta[name="twitter:title"]').attr('content') !== expectedTitle
        || document('meta[name="twitter:description"]').attr('content') !== route.description
        || document('meta[name="twitter:url"]').attr('content') !== route.canonicalUrl
        || document('meta[name="twitter:image"]').attr('content') !== route.openGraphImage
    ) {
        throw new Error(`Invalid social metadata in ${route.pathname}`);
    }
    const schemaCount = document('script[type="application/ld+json"]').length;
    if ((route.pathname === '/' && schemaCount !== 1) || (route.pathname !== '/' && schemaCount !== 0)) {
        throw new Error(`Unexpected structured data in ${route.pathname}`);
    }
    if (route.pathname !== '/' && document('noscript').length !== 0) {
        throw new Error(`Homepage noscript fallback leaked into ${route.pathname}`);
    }

    renderedPages.push({ pathname: route.pathname, title });
}

if (new Set(renderedPages.map((page) => page.title)).size !== renderedPages.length) {
    throw new Error('Prerendered public route titles are not unique');
}

const appShellHtml = await readFile(resolve(distDirectory, 'app-shell.html'), 'utf8');
const appShell = load(appShellHtml);
if (appShell('meta[name="robots"]').attr('content') !== 'noindex, nofollow') {
    throw new Error('Private app shell must declare noindex, nofollow');
}
if (appShell('link[rel="canonical"], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"], noscript, #root > *').length !== 0) {
    throw new Error('Private app shell contains public or visible fallback content');
}

const notFoundHtml = await readFile(resolve(distDirectory, '404.html'), 'utf8');
const notFound = load(notFoundHtml);
if (
    notFound('meta[name="robots"]').attr('content') !== 'noindex, nofollow'
    || notFound('link[rel="canonical"]').length !== 0
    || notFound('h1').length !== 1
) {
    throw new Error('Static 404 document is missing noindex metadata or its heading');
}

console.log(`Validated ${renderedPages.length} public routes, the private shell, and the 404 document`);