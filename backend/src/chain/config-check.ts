import { Keypair } from '@solana/web3.js';
import type { Env } from '../config/env.js';
import { rechargeLimits } from '../domain/payment.js';
import { programConfigIssues, type ExpectedProgramConfig, type ProgramConfigIssue } from './program-client.js';
import type { TokenGateway } from './token-gateway.js';

/** What the deployed Config must allow for this backend: our minter and our largest recharge. */
export function expectedProgramConfig(env: Env): ExpectedProgramConfig {
  const simMax = rechargeLimits('simulated', env).maxCents;
  return {
    minter: Keypair.fromSecretKey(env.minterSecretKey).publicKey,
    maxRechargeCents: env.MAX_RECHARGE_CENTS > simMax ? env.MAX_RECHARGE_CENTS : simMax,
  };
}

/** Reads the on-chain Config and lists deployment issues. Throws TransientChainError on RPC failure. */
export async function checkProgramConfig(
  token: Pick<TokenGateway, 'programConfig'>,
  expected: ExpectedProgramConfig,
): Promise<{ paused: boolean; configIssues: ProgramConfigIssue[] }> {
  const cfg = await token.programConfig();
  return { paused: cfg.paused, configIssues: programConfigIssues(cfg, expected) };
}
