import type { PaymentRepository } from '../repositories/payment-repository.js';
import type { PaymentProcessor, ProcessorLog } from './payment-processor.js';

export interface ReconcilerDeps {
  payments: Pick<PaymentRepository, 'listOpen'>;
  processor: Pick<PaymentProcessor, 'signal' | 'process'>;
  intervalMs: number;
  log: ProcessorLog;
}

export interface Reconciler {
  /** One pass over every open payment. Overlapping calls join the pass already running. */
  tick(): Promise<void>;
  /** Immediate tick (boot resume), then one every intervalMs. */
  start(): void;
  /** Clears the interval and waits for an in-flight tick. */
  stop(): Promise<void>;
}

/** Class name only: messages and causes may embed the RPC URL (with key). */
function errorClass(e: unknown): string {
  return e instanceof Error && /^\w{1,64}$/.test(e.name) ? e.name : 'Error';
}

export function createReconciler({ payments, processor, intervalMs, log }: ReconcilerDeps): Reconciler {
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function pass(): Promise<void> {
    const open = await payments.listOpen();
    for (const p of open) {
      try {
        if (p.status === 'AWAITING_PAYMENT') await processor.signal(p.id, 'reconciler');
        else await processor.process(p.id);
      } catch (e) {
        log.error({ paymentId: p.id, error: errorClass(e) }, 'reconciler: payment failed; continuing');
      }
    }
  }

  function tick(): Promise<void> {
    if (running) return running;
    const run: Promise<void> = pass()
      .catch((e) => {
        log.error({ error: errorClass(e) }, 'reconciler: tick failed');
      })
      .finally(() => {
        if (running === run) running = null;
      });
    running = run;
    return run;
  }

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
    },
  };
}
