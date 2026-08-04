import routeData from './publicRoutes.json';

const PUBLIC_CONTENT_TYPES = ['WebApplication', 'Article', 'TechArticle', 'HowTo'] as const;
export type PublicContentType = (typeof PUBLIC_CONTENT_TYPES)[number];

export interface PublicRoute {
    pathname: string;
    title: string;
    description: string;
    canonicalUrl: string;
    contentType: PublicContentType;
    lastmod: string;
    openGraphImage?: string;
    includeInSitemap: boolean;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = routeData.map((route) => {
    if (!PUBLIC_CONTENT_TYPES.includes(route.contentType as PublicContentType)) {
        throw new Error(`Unsupported public content type: ${route.contentType}`);
    }

    return { ...route, contentType: route.contentType as PublicContentType };
});

export const getPublicRoute = (pathname: PublicRoute['pathname']): PublicRoute => {
    const route = PUBLIC_ROUTES.find((candidate) => candidate.pathname === pathname);

    if (!route) {
        throw new Error(`Unknown public route: ${pathname}`);
    }

    return route;
};

export const getOpenGraphType = (route: PublicRoute): 'website' | 'article' => (
    route.contentType === 'WebApplication' ? 'website' : 'article'
);