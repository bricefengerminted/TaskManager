import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

describe('harness', () => {
  it('serves the health endpoint', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('seeds the General project', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === 'general')).toBe(true);
  });
});
