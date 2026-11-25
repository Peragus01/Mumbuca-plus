import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

describe('static frontend', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('serves files, falls back to index.html for SPA routes, never for /api or /webhooks', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mp-static-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mumbuca+</title>');
    writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
    const t = await setupApp({}, { staticDir: dir });
    const get = (url: string) => t.app.inject({ method: 'GET', url });

    expect((await get('/')).body).toContain('Mumbuca+');
    expect((await get('/app.js')).body).toBe('console.log(1)');
    const spa = await get('/usuarios/123');
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('Mumbuca+');
    const api = await get('/api/nope');
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not_found' });
    expect((await get('/webhooks/nope')).statusCode).toBe(404);
  });

  it('token metadata under /token/ is readable cross-origin (wallets, explorers); other files are not', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mp-static-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mumbuca+</title>');
    writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
    mkdirSync(path.join(dir, 'token'));
    writeFileSync(path.join(dir, 'token', 'mum.json'), '{"name":"Mumbuca+"}');
    const t = await setupApp({}, { staticDir: dir });

    const meta = await t.app.inject({ method: 'GET', url: '/token/mum.json' });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toEqual({ name: 'Mumbuca+' });
    expect(meta.headers['access-control-allow-origin']).toBe('*');

    const js = await t.app.inject({ method: 'GET', url: '/app.js' });
    expect(js.headers['access-control-allow-origin']).toBeUndefined();

    // A missing token file is a JSON 404, never the SPA page.
    const missing = await t.app.inject({ method: 'GET', url: '/token/missing.json' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
  });

  it('without staticDir unknown routes are JSON 404', async () => {
    const t = await setupApp();
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
