type NavigationFetcher = (request: Request) => Promise<Response>;
type NavigationFallback = () => Promise<Response>;

export const fetchNavigationWithFallback = async (
    request: Request,
    fetchNetwork: NavigationFetcher,
    fallback: NavigationFallback,
): Promise<Response> => {
    try {
        return await fetchNetwork(request);
    } catch {
        return fallback();
    }
};