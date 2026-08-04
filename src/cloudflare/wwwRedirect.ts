const CANONICAL_HOST = 'arphen.xyz'

export function redirectToCanonicalHost(request: Request): Response {
    const target = new URL(request.url)
    target.protocol = 'https:'
    target.hostname = CANONICAL_HOST
    target.port = ''

    return Response.redirect(target, 301)
}

export default {
    fetch: redirectToCanonicalHost,
}