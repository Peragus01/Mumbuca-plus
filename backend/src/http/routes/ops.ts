import type { FastifyPluginAsync } from 'fastify';
import { checkProgramConfig, expectedProgramConfig } from '../../chain/config-check.js';
import { mintPda } from '../../chain/pdas.js';
import type { ProgramConfigIssue } from '../../chain/program-client.js';
import type { TokenGateway } from '../../chain/token-gateway.js';
import type { Env } from '../../config/env.js';
import { errorClass } from '../errors.js';

export interface OpsRoutesOptions {
  env: Env;
  token: TokenGateway;
}

export const opsRoutes: FastifyPluginAsync<OpsRoutesOptions> = async (app, { env, token }) => {
  const mintAddress = mintPda(env.PROGRAM_ID).toBase58();
  const expected = expectedProgramConfig(env);

  app.get('/ops/status', async (req, reply) => {
    let paused: boolean;
    let configIssues: ProgramConfigIssue[];
    let lamports: bigint;
    try {
      [{ paused, configIssues }, lamports] = await Promise.all([
        checkProgramConfig(token, expected),
        token.minterNativeBalance(),
      ]);
    } catch (e) {
      req.log.warn({ error: errorClass(e) }, 'ops status: chain lookup failed');
      return reply.code(503).send({ error: 'chain_unavailable' });
    }
    return {
      providerEnv: env.PROVIDER_ENV,
      programId: env.PROGRAM_ID,
      mintAddress,
      cluster: env.SOLANA_CLUSTER,
      paused,
      minterLamports: lamports.toString(),
      lowSol: lamports < env.LOW_SOL_THRESHOLD_LAMPORTS,
      // Deployment check (minter, max_mint_per_tx, pause): mints cannot succeed while not OK.
      configOk: configIssues.length === 0,
      configIssues,
    };
  });
};
