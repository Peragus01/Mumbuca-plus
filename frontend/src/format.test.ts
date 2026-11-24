import { describe, expect, it } from 'vitest';
import { formatBRL, formatMum, parseReaisToCents, shortAddress, statusLabel } from './format';

describe('formatBRL', () => {
  it('formats cents as reais', () => {
    expect(formatBRL('1100')).toBe('R$ 11,00');
    expect(formatBRL('100000')).toBe('R$ 1.000,00');
    expect(formatBRL('5')).toBe('R$ 0,05');
    expect(formatBRL('0')).toBe('R$ 0,00');
    expect(formatBRL('123456789')).toBe('R$ 1.234.567,89');
  });
});

describe('formatMum', () => {
  it('formats base units with 2 decimals', () => {
    expect(formatMum('1100')).toBe('11,00 Mum+');
    expect(formatMum('100000')).toBe('1.000,00 Mum+');
    expect(formatMum('1')).toBe('0,01 Mum+');
  });

  it('is exact beyond Number precision', () => {
    expect(formatMum('900719925474099312')).toBe('9.007.199.254.740.993,12 Mum+');
  });
});

describe('shortAddress', () => {
  it('keeps 4 + 4 characters of a base58 address', () => {
    expect(shortAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU9fQa')).toBe('7xKX…9fQa');
  });

  it('leaves short strings untouched', () => {
    expect(shortAddress('abcdefgh')).toBe('abcdefgh');
  });
});

describe('statusLabel', () => {
  it('maps every status', () => {
    expect(statusLabel('AWAITING_PAYMENT')).toBe('Aguardando Pix');
    expect(statusLabel('RECEIVED')).toBe('Pagamento confirmado');
    expect(statusLabel('VALIDATING')).toBe('Confirmando pagamento');
    expect(statusLabel('APPROVED')).toBe('Emitindo');
    expect(statusLabel('MINT_PENDING')).toBe('Emitindo');
    expect(statusLabel('MINTED')).toBe('Emitido');
    expect(statusLabel('FAILED')).toBe('Falhou');
  });
});

describe('parseReaisToCents', () => {
  it('accepts common pt-BR inputs', () => {
    expect(parseReaisToCents('50')).toBe('5000');
    expect(parseReaisToCents('50,5')).toBe('5050');
    expect(parseReaisToCents('R$ 1.000,25')).toBe('100025');
    expect(parseReaisToCents('11.50')).toBe('1150');
    expect(parseReaisToCents('0,01')).toBe('1');
  });

  it('rejects invalid or empty values', () => {
    expect(parseReaisToCents('')).toBeNull();
    expect(parseReaisToCents('abc')).toBeNull();
    expect(parseReaisToCents('1,234')).toBeNull();
    expect(parseReaisToCents('-5')).toBeNull();
    expect(parseReaisToCents('0')).toBeNull();
  });
});
