import { describe, it, expect } from 'vitest';
import { parseBrlToCents, centsToUnits, formatUnitsMum, formatCentsBRL, paymentRefFor } from '../../src/domain/money.js';

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
  it('centsToUnits is identity (2 decimals)', () => expect(centsToUnits(1100n)).toBe(1100n));
  it('formatUnitsMum', () => {
    expect(formatUnitsMum(1100n)).toBe('11,00 Mum+');
    expect(formatUnitsMum(100000n)).toBe('1.000,00 Mum+');
    expect(formatUnitsMum(5n)).toBe('0,05 Mum+');
  });
  it('formatCentsBRL', () => {
    expect(formatCentsBRL(100000n)).toBe('R$ 1.000,00');
    expect(formatCentsBRL(5n)).toBe('R$ 0,05');
  });
  it('paymentRefFor', () => {
    expect(paymentRefFor('ozav', 'ozav_tr_1')).toBe(
      '0x20f0a97065550aaa713b14cdf7a5934e3e299056efb3266d31157fc1ed9f9a94',
    );
  });
});
