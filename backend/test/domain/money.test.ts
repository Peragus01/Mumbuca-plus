import { describe, it, expect } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { parseBrlToCents, centsToWei, formatCentsBRL, paymentRefFor } from '../../src/domain/money.js';

describe('parseBrlToCents', () => {
  it('parses valid amounts', () => {
    expect(parseBrlToCents('11')).toEqual({ cents: 1100n, truncated: false });
    expect(parseBrlToCents('1000.00')).toEqual({ cents: 100000n, truncated: false });
    expect(parseBrlToCents('0.01')).toEqual({ cents: 1n, truncated: false });
  });
  it('truncates beyond 2 decimals, never rounding up', () => {
    expect(parseBrlToCents('11.005')).toEqual({ cents: 1100n, truncated: true });
    expect(parseBrlToCents('11.999999')).toEqual({ cents: 1199n, truncated: true });
    expect(parseBrlToCents('11.000')).toEqual({ cents: 1100n, truncated: false });
  });
  it('rejects invalid formats', () => {
    for (const v of ['-1', '1e3', '11,00', '', '01', '1.1234567']) expect(parseBrlToCents(v)).toBeNull();
  });
});

describe('conversions', () => {
  it('centsToWei', () => expect(centsToWei(1100n)).toBe(11n * 10n ** 18n));
  it('formatCentsBRL', () => {
    expect(formatCentsBRL(100000n)).toBe('R$ 1.000,00');
    expect(formatCentsBRL(5n)).toBe('R$ 0,05');
  });
  it('paymentRefFor', () => {
    expect(paymentRefFor('ozav', 'ozav_tr_1')).toBe(keccak256(toBytes('ozav:ozav_tr_1')));
  });
});
