const request = require('supertest');
const app = require('../server');

jest.setTimeout(45000);

describe('Server Security & API Integration Tests', () => {
    
    describe('Security Isolation Tests', () => {
        it('should NOT allow access to sensitive root cookies.txt file', async () => {
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
    });

    describe('/analyze Endpoint', () => {
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
    });

    describe('/download Endpoint', () => {
        it('should return 400 Bad Request when url parameter is missing', async () => {
            const res = await request(app).get('/download');
            expect(res.statusCode).toBe(400);
            expect(res.text).toContain('Invalid URL provided');
        });

        it('should return 400 Bad Request when empty url parameter is provided', async () => {
            const res = await request(app).get('/download?url=');
            expect(res.statusCode).toBe(400);
            expect(res.text).toContain('Invalid URL provided');
        });

        it('should NEVER return HTML redirect to external sites on download failure', async () => {
            const res = await request(app).get('/download?url=not_a_valid_url');
            expect(res.statusCode).toBe(400);
            expect(res.headers['content-type']).not.toMatch(/text\/html/);
            expect(res.text).not.toContain('ssyoutube');
            expect(res.text).not.toContain('savefrom');
        });

        it('should handle /api/download route alias and encoded YouTube URLs correctly', async () => {
            const testUrl = encodeURIComponent('https://youtu.be/U9KUW63Jqhc?si=oROLxb8N-M8yFKjz');
            const res = await request(app).get(`/api/download?url=${testUrl}`);
            // Should be handled by server (either return stream or 400 JSON on extraction fail, NEVER 404 or HTML)
            expect(res.statusCode).not.toBe(404);
            expect(res.headers['content-type']).not.toMatch(/text\/html/);
        });
    });

    describe('Route Aliases (/api/*)', () => {
        it('should support /api/analyze route alias', async () => {
            const res = await request(app)
                .post('/api/analyze')
                .send({ url: 'https://youtu.be/U9KUW63Jqhc' });
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should support /api/progress route alias', async () => {
            const res = await request(app).get('/api/progress?id=non_existent');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ success: false });
        });
    });

    describe('/progress Endpoint', () => {
        it('should return success: false for non-existent progress id', async () => {
            const res = await request(app).get('/progress?id=invalid_id_999');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ success: false });
        });

        it('should return success: false for prototype pollution keys', async () => {
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
