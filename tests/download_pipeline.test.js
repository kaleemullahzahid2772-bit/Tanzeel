const request = require('supertest');
const app = require('../server');
const { proxyVideoStream } = require('../src/services/ytdlp');

jest.setTimeout(30000);

describe('End-to-End Download Pipeline & Validation Tests', () => {

    describe('1. URL Validation & Input Guarding', () => {
        it('should return 400 with structured JSON for invalid non-HTTP URL', async () => {
            const res = await request(app).get('/download?url=ftp://invalid-protocol.com');
            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBe('INVALID_URL');
            expect(res.body.message).toBe('Invalid URL provided');
        });

        it('should return 400 with structured JSON for missing URL parameter', async () => {
            const res = await request(app).get('/download');
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBe('INVALID_URL');
        });
    });

    describe('2. Media Type & Stream Proxy Validation', () => {
        it('should reject non-media Content-Type (HTML/JSON) in proxyVideoStream', async () => {
            const mockRes = {
                setHeader: jest.fn(),
                on: jest.fn()
            };
            // Passing a URL that returns text/html should be rejected
            const result = await proxyVideoStream('https://example.com', 'Test_Title', mockRes, 'test_id', null, 0, null);
            expect(result).toBe(false);
        });

        it('should reject SSRF / private IP target URLs in proxyVideoStream', async () => {
            const mockRes = {
                setHeader: jest.fn(),
                on: jest.fn()
            };
            const result = await proxyVideoStream('http://127.0.0.1:3000/internal', 'Test_Title', mockRes, 'test_id', null, 0, null);
            expect(result).toBe(false);
        });
    });

    describe('3. Error Handling & Structured Response Format', () => {
        it('should return 400 JSON response (never HTML or raw text) when extraction fails', async () => {
            const res = await request(app).get('/download?url=https://example.com/unsupported-video-page');
            expect(res.headers['content-type']).toMatch(/application\/json/);
            expect(res.statusCode).toBe(400);
            expect(res.body).toEqual({
                success: false,
                error: 'EXTRACTION_FAILED',
                message: 'The source did not provide a downloadable media stream.'
            });
        });

        it('should handle /api/download route alias consistently', async () => {
            const res = await request(app).get('/api/download?url=https://example.com/unsupported');
            expect(res.headers['content-type']).toMatch(/application\/json/);
            expect(res.statusCode).toBe(400);
            expect(res.body.error).toBe('EXTRACTION_FAILED');
        });
    });

    describe('4. Progress Tracking Endpoint', () => {
        it('should return progress data when downloadId exists', async () => {
            const { setProgress, deleteProgress } = require('../src/utils/progress');
            setProgress('test_prog_123', { percent: 45, status: 'Downloading...' });
            
            const res = await request(app).get('/progress?id=test_prog_123');
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.percent).toBe(45);

            deleteProgress('test_prog_123');
        });
    });
});
