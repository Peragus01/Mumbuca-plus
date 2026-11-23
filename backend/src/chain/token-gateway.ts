import {
  BaseError,
  ContractFunctionRevertedError,
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { tokenAbi } from './token-abi.js';

type Hex = `0x${string}`;
export type ReceiptInfo = { status: 'success' | 'reverted'; blockNumber: bigint };

export interface TokenGateway {
  sendMint(to: Hex, amountWei: bigint, paymentRef: Hex): Promise<Hex>;
  getReceipt(hash: Hex): Promise<ReceiptInfo | null>;
  /** Returns null on timeout. */
  waitForReceipt(hash: Hex, timeoutMs: number): Promise<ReceiptInfo | null>;
  isPaymentRefUsed(paymentRef: Hex): Promise<boolean>;
  findMintTx(paymentRef: Hex): Promise<{ txHash: Hex; blockNumber: bigint } | null>;
  balanceOf(address: Hex): Promise<bigint>;
  minterNativeBalance(): Promise<bigint>;
  isPaused(): Promise<boolean>;
}

/** Network/timeout/5xx/nonce/gas errors: not a decoded contract revert, safe to retry later. */
export class TransientChainError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientChainError';
  }
}

/** The mint simulation reverted; `reason` is the custom error name (e.g. "PaymentRefAlreadyUsed"). */
export class MintRevertedError extends Error {
  readonly reason: string;
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Mint reverted: ${reason}`, options);
    this.name = 'MintRevertedError';
    this.reason = reason;
  }
}

function decodedRevertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName ?? undefined;
  }
  return undefined;
}

function transient(err: unknown, what: string): TransientChainError {
  if (err instanceof TransientChainError) return err;
  const msg = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
  return new TransientChainError(`${what}: ${msg}`, { cause: err });
}

async function wrap<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw transient(err, what);
  }
}

export function createViemTokenGateway(opts: {
  rpcUrl: string;
  chainId: number;
  tokenAddress: Hex;
  minterPrivateKey: Hex;
  /**
   * Lower bound for the getContractEvents scan in findMintTx. Public RPCs (e.g. Amoy)
   * may reject wide log ranges, so set this to the token's deployment block in production.
   */
  logsFromBlock?: bigint;
}): TokenGateway {
  const chain = defineChain({
    id: opts.chainId,
    name: `chain-${opts.chainId}`,
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const account = privateKeyToAccount(opts.minterPrivateKey);
  const publicClient = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(opts.rpcUrl) });
  const address = opts.tokenAddress;

  return {
    async sendMint(to, amountWei, paymentRef) {
      let request;
      try {
        ({ request } = await publicClient.simulateContract({
          address,
          abi: tokenAbi,
          functionName: 'mint',
          args: [to, amountWei, paymentRef],
          account,
        }));
      } catch (err) {
        const reason = decodedRevertName(err);
        if (reason) throw new MintRevertedError(reason, { cause: err });
        throw transient(err, 'simulate mint');
      }
      return wrap('send mint', () => walletClient.writeContract(request));
    },

    async getReceipt(hash) {
      try {
        const r = await publicClient.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber };
      } catch (err) {
        if (err instanceof BaseError && err.name === 'TransactionReceiptNotFoundError') return null;
        throw transient(err, 'get receipt');
      }
    },

    async waitForReceipt(hash, timeoutMs) {
      try {
        const r = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
        return { status: r.status, blockNumber: r.blockNumber };
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) return null;
        throw transient(err, 'wait for receipt');
      }
    },

    isPaymentRefUsed: (paymentRef) =>
      wrap('paymentRefUsed', () =>
        publicClient.readContract({ address, abi: tokenAbi, functionName: 'paymentRefUsed', args: [paymentRef] }),
      ),

    async findMintTx(paymentRef) {
      const logs = await wrap('find mint tx', () =>
        publicClient.getContractEvents({
          address,
          abi: tokenAbi,
          eventName: 'MintedForPayment',
          args: { paymentRef },
          fromBlock: opts.logsFromBlock ?? 0n,
          toBlock: 'latest',
        }),
      );
      const log = logs[0];
      if (!log || log.transactionHash === null || log.blockNumber === null) return null;
      return { txHash: log.transactionHash, blockNumber: log.blockNumber };
    },

    balanceOf: (addr) =>
      wrap('balanceOf', () =>
        publicClient.readContract({ address, abi: tokenAbi, functionName: 'balanceOf', args: [addr] }),
      ),

    minterNativeBalance: () => wrap('minter balance', () => publicClient.getBalance({ address: account.address })),

    isPaused: () => wrap('paused', () => publicClient.readContract({ address, abi: tokenAbi, functionName: 'paused' })),
  };
}
