const { getTikTokStreamUrl } = require('../src/services/tiktok');
const { getInstagramStreamUrl } = require('../src/services/instagram');
const { getTwitterStreamUrl } = require('../src/services/twitter');
const { getFacebookStreamUrl } = require('../src/services/facebook');

describe('Platform Specialized Extraction Services', () => {
    it('should export valid functions for all platforms', () => {
        expect(typeof getTikTokStreamUrl).toBe('function');
        expect(typeof getInstagramStreamUrl).toBe('function');
        expect(typeof getTwitterStreamUrl).toBe('function');
        expect(typeof getFacebookStreamUrl).toBe('function');
    });

    it('should safely return null for invalid URLs', async () => {
        const result = await getTikTokStreamUrl('https://invalid-domain-test.com');
        expect(result).toBeNull();
    });
});
