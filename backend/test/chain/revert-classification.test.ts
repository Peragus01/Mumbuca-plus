import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError } from 'viem';
import { tokenAbi } from '../../src/chain/token-abi.js';
import { decodedRevertName } from '../../src/chain/token-gateway.js';

describe('decodedRevertName', () => {
  it('maps an undecodable contract revert (no errorName) to UnknownRevert', () => {
    const err = new ContractFunctionRevertedError({ abi: tokenAbi, functionName: 'mint' });
    expect(err.data?.errorName).toBeUndefined();
    expect(decodedRevertName(err)).toBe('UnknownRevert');
  });
  it('returns undefined for non-revert errors', () => {
    expect(decodedRevertName(new BaseError('network down'))).toBeUndefined();
    expect(decodedRevertName(new Error('x'))).toBeUndefined();
  });
});
