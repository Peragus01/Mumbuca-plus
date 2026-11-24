import type { FastifyPluginAsync } from 'fastify';
import { mintPda } from '../../chain/pdas.js';
import type { TokenGateway } from '../../chain/token-gateway.js';
import type { Env } from '../../config/env.js';
import { errorClass } from '../errors.js';

export interface OpsRoutesOptions {
  env: Env;
  token: TokenGateway;
}

export const opsRoutes: FastifyPluginAsync<OpsRoutesOptions> = async (app, { env, token }) => {
  const mintAddress = mintPda(env.PROGRAM_ID).toBase58();

  app.get('/ops/status', async (req, reply) => {
    let paused: boolean;
    let lamports: bigint;
    try {
      [paused, lamports] = await Promise.all([token.isPaused(), token.minterNativeBalance()]);
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
    };
  });
};
