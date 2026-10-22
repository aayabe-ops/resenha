import type { Bindings } from './context';

/**
 * Envia o código de login (ACE-02). No modo dev, o código aparece no console
 * do Wrangler, nunca com o celular. O envio real pelo WhatsApp Cloud API
 * depende da conta da Meta e da hospedagem (ADR 0003, questão em aberto #0).
 */
export async function sendLoginCode(
  env: Pick<Bindings, 'WHATSAPP_MODE'>,
  message: { phone: string; code: string },
): Promise<void> {
  if (env.WHATSAPP_MODE === 'dev') {
    console.log(`[whatsapp:dev] código de login: ${message.code}`);
    return;
  }
  throw new Error('Envio pelo WhatsApp Cloud API ainda não configurado');
}
