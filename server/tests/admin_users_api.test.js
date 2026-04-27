import request from 'supertest';
import { startServer } from '../server.js';
import jwt from 'jsonwebtoken';
import { getCurrentSigningKey } from '../keyManager.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Admin Users API', () => {
    let serverData;
    let adminToken;
    let userToken;
    let testDbPath = path.join(__dirname, '..', 'test_admin_api_db.json');

    beforeAll(async () => {
        const initialData = { orders: {}, users: {}, emailIndex: {}, credentials: {}, config: {}, products: {} };
        fs.writeFileSync(testDbPath, JSON.stringify(initialData));

        process.env.TEST_USE_REAL_DB = 'true';
        process.env.TEST_DB_PATH = testDbPath;
        process.env.DB_PATH = testDbPath;
        process.env.ADMIN_EMAIL = 'admin@test.com';

        serverData = await startServer(null, null, undefined, testDbPath);

        const { privateKey, kid } = getCurrentSigningKey();

        // Setup initial admin and normal user tokens for testing roles
        adminToken = jwt.sign({ username: 'admin', email: 'admin@test.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
        userToken = jwt.sign({ username: 'normal_user', email: 'user@test.com' }, privateKey, { algorithm: 'RS256', expiresIn: '1h', header: { kid } });
    });

    afterAll(async () => {
        if (serverData && serverData.timers) {
    if (typeof server !== "undefined" && server.close) await server.close();

    if (typeof serverData !== "undefined" && serverData.close) await serverData.close();
        }
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        delete process.env.TEST_USE_REAL_DB;
        delete process.env.DB_PATH;
        delete process.env.ADMIN_EMAIL;
    });

    it('should create a new user when called by an admin', async () => {
        const csrfRes = await request(serverData.app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const res = await request(serverData.app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('Cookie', cookies)
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'api_created_user', password: 'apipassword123', role: 'user' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('User created successfully');
    });

    it('should block user creation when called by a normal user', async () => {
        const csrfRes = await request(serverData.app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const res = await request(serverData.app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Cookie', cookies)
            .set('X-CSRF-Token', csrfToken)
            .send({ username: 'hacker_user', password: 'hackedpassword', role: 'admin' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Forbidden: Admin access required.');
    });

    it('should list users when called by an admin', async () => {
        const res = await request(serverData.app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.usernames).toContain('api_created_user');
    });

    it('should prevent listing users when called by a normal user', async () => {
        const res = await request(serverData.app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.status).toBe(403);
    });

    it('should delete a user when called by an admin', async () => {
        const csrfRes = await request(serverData.app).get('/api/csrf-token');
        const csrfToken = csrfRes.body.csrfToken;
        const cookies = csrfRes.headers['set-cookie'];

        const deleteRes = await request(serverData.app)
            .delete('/api/admin/users/api_created_user')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('Cookie', cookies)
            .set('X-CSRF-Token', csrfToken);

        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.success).toBe(true);

        // Verify they are gone
        const listRes = await request(serverData.app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(listRes.body.usernames).not.toContain('api_created_user');
    });
});