import { describe, expect, it } from 'vitest';
import { MintRejectedError, TransientChainError } from '../../src/chain/token-gateway.js';
import {
  ProviderNotEnabledError,
  RechargeLimitError,
  UnknownUserError,
} from '../../src/processing/payment-processor.js';

// The reconciler/processor/HTTP layer log `e.name` only, so every error class must set it.
describe('error classes set name', () => {
  it.each([
    [new TransientChainError('x'), 'TransientChainError'],
    [new MintRejectedError('Paused'), 'MintRejectedError'],
    [new RechargeLimitError(1n, 2n), 'RechargeLimitError'],
    [new UnknownUserError('u'), 'UnknownUserError'],
    [new ProviderNotEnabledError('p'), 'ProviderNotEnabledError'],
  ])('%s', (err, name) => {
    expect(err.name).toBe(name);
    expect(Object.prototype.toString.call(err)).toBe('[object Error]');
    expect(String(err).startsWith(`${name}:`)).toBe(true);
  });
});
