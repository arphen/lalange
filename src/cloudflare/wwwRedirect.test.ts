import { describe, expect, it } from 'vitest'
import { redirectToCanonicalHost } from './wwwRedirect'

describe('redirectToCanonicalHost', () => {
    it.each([
        ['http://www.arphen.xyz/', 'https://arphen.xyz/'],
        ['https://www.arphen.xyz/manual', 'https://arphen.xyz/manual'],
        [
            'https://www.arphen.xyz/research?source=google#results',
            'https://arphen.xyz/research?source=google#results',
        ],
    ])('redirects %s to %s', (source, destination) => {
        const response = redirectToCanonicalHost(new Request(source))

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe(destination)
    })
})