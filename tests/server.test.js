const request = require('supertest');
const app = require('../server');

jest.setTimeout(15000);

describe('Tanzeel Server Security, API & Unit Tests', () => {

    describe('Security Isolation Tests', () => {
        it('should NOT allow access to root cookies.txt file', async () => {
            const res = await request(app).get('/cookies.txt');
            expect(res.statusCode).toBe(404);
        });

        it('should NOT allow access to server source code server.js', async () => {
            const res = await request(app).get('/server.js');
            expect(res.statusCode).toBe(404);
        });

        it('should NOT allow access to root package.json', async () => {
            const res = await request(app).get('/package.json');
            expect(res.statusCode).toBe(404);
        });

        it('should allow access to public static assets (index.html)', async () => {
            const res = await request(app).get('/');
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toMatch(/html/);
        });

        it('should set security headers on responses', async () => {
            const res = await request(app).get('/');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
            expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
            expect(res.headers['x-powered-by']).toBeUndefined();
        });
    });

    describe('/analyze Endpoint & SSRF Validation', () => {
        it('should return 400 Bad Request when no URL is provided', async () => {
            const res = await request(app)
                .post('/analyze')
                .send({});
            
            expect(res.statusCode).toBe(400);
            expect(res.body).toEqual({
                success: false,
                message: 'Invalid URL provided'
            });
        });

        it('should return 400 Bad Request when invalid data type is provided for URL', async () => {
            const res = await request(app)
                .post('/analyze')
                .send({ url: 12345 });
            
            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should REJECT SSRF attempts targeting localhost (127.0.0.1 / localhost)', async () => {
            const res = await request(app)
                .post('/analyze')
                .send({ url: 'http://127.0.0.1:3000/internal' });
            
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid URL provided');
        });

        it('should REJECT SSRF attempts targeting AWS metadata IP (169.254.169.254)', async () => {
            const res = await request(app)
                .post('/analyze')
                .send({ url: 'http://169.254.169.254/latest/meta-data/' });
            
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid URL provided');
        });

        it('should REJECT non-HTTP/HTTPS dangerous protocols (file://, javascript:)', async () => {
            const res = await request(app)
                .post('/analyze')
                .send({ url: 'file:///etc/passwd' });
            
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid URL provided');
        });
    });

    describe('/download Endpoint & Resilience', () => {
        it('should return 400 Bad Request when url parameter is missing', async () => {
            const res = await request(app).get('/download');
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid URL provided');
        });

        it('should return 400 Bad Request when empty url parameter is provided', async () => {
            const res = await request(app).get('/download?url=');
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid URL provided');
        });

        it('should return 400 Bad Request for invalid non-HTTP URL string', async () => {
            const res = await request(app).get('/download?url=not_a_valid_url');
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid URL provided');
        });

        it('should NEVER return HTML redirect to external sites on download failure', async () => {
            const res = await request(app).get('/download?url=https://example.com/fakevideo');
            expect(res.statusCode).toBe(400);
            expect(res.headers['content-type']).toMatch(/json/);
            expect(res.body.success).toBe(false);
        });

        it('should handle /api/download route alias correctly', async () => {
            const res = await request(app).get('/api/download?url=https://example.com/invalid');
            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('Route Aliases & Progress Tracking', () => {
        it('should support /api/progress route alias with non-existent id', async () => {
            const res = await request(app).get('/api/progress?id=non_existent');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ success: false });
        });

        it('should return success: false for prototype pollution keys on /progress', async () => {
            const res1 = await request(app).get('/progress?id=__proto__');
            expect(res1.statusCode).toBe(200);
            expect(res1.body).toEqual({ success: false });

            const res2 = await request(app).get('/progress?id=toString');
            expect(res2.statusCode).toBe(200);
            expect(res2.body).toEqual({ success: false });
        });
    });

    describe('Body Parser Error Handling', () => {
        it('should return 400 Bad Request on malformed JSON payload', async () => {
            const res = await request(app)
                .post('/analyze')
                .set('Content-Type', 'application/json')
                .send('{ invalid_json: ');
            
            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('Invalid JSON request payload');
        });
    });
});
