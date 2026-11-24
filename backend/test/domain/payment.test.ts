import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { rechargeLimits } from '../../src/domain/payment.js';
import { validEnv } from '../helpers/valid-env.js';

describe('rechargeLimits', () => {
  const env = loadEnv({ ...validEnv, MIN_RECHARGE_CENTS: '500', MAX_RECHARGE_CENTS: '90000' });
  it('simulated uses fixed limits', () => {
    expect(rechargeLimits('simulated', env)).toEqual({ minCents: 1100n, maxCents: 2000000n });
  });
  it('ozav uses env values', () => {
    expect(rechargeLimits('ozav', env)).toEqual({ minCents: 500n, maxCents: 90000n });
  });
});
