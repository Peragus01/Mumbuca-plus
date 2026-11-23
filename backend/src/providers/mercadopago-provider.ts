import type { PaymentProvider } from './payment-provider.js';

const notImplemented = (): never => {
  throw new Error('Mercado Pago não implementado neste MVP');
};

/** Stub: every method throws. See docs/providers/mercadopago.md for what a real integration needs. */
export function createMercadoPagoProvider(): PaymentProvider {
  return {
    name: 'mercadopago',
    env: 'sandbox',
    createCharge: async () => notImplemented(),
    fetchPayment: async () => notImplemented(),
    verifyWebhook: () => notImplemented(),
    simulatePayment: async () => notImplemented(),
    findChargeByPaymentId: async () => notImplemented(),
  };
}
