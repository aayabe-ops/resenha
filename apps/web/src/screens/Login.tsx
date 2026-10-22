import {
  birthDateSchema,
  isUnderMinAge,
  loginCodeSchema,
  nicknameSchema,
  phoneSchema,
} from '@resenha/shared';
import { useState } from 'react';
import { api, errorMessage } from '../api';
import { toE164 } from '../phone';
import { Form } from './Form';

type Step =
  | { name: 'birthDate' }
  | { name: 'underAge' }
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'nickname'; registrationToken: string };

// Fluxo de entrada: nascimento primeiro (ACE-03), depois celular e código
// (ACE-02) e, no primeiro acesso, o apelido. O nascimento fica só na memória
// da tela até ser enviado.
export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [step, setStep] = useState<Step>({ name: 'birthDate' });
  const [birthDate, setBirthDate] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  switch (step.name) {
    case 'birthDate':
      return (
        // TODO(copy): revisar
        <Form
          title="Quando você nasceu?"
          submitLabel="Continuar"
          busy={busy}
          error={error}
          onSubmit={() => {
            if (!birthDateSchema.safeParse(birthDate).success) {
              setError('Coloca uma data válida.'); // TODO(copy): revisar
              return;
            }
            setError(null);
            setStep(isUnderMinAge(birthDate) ? { name: 'underAge' } : { name: 'phone' });
          }}
        >
          <label>
            Data de nascimento
            <input
              type="date"
              required
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
            />
          </label>
        </Form>
      );

    case 'underAge':
      // TODO(copy): revisar
      return (
        <section>
          <h2>Ainda não dá</h2>
          <p>A Resenha é só para quem tem 15 anos ou mais. Nenhum dado seu foi guardado.</p>
        </section>
      );

    case 'phone':
      return (
        // TODO(copy): revisar
        <Form
          title="Qual é o seu celular?"
          submitLabel="Receber código no WhatsApp"
          busy={busy}
          error={error}
          onSubmit={() =>
            run(async () => {
              const phone = toE164(phoneInput);
              if (!phoneSchema.safeParse(phone).success) {
                setError('Confere o número, com DDD.'); // TODO(copy): revisar
                return;
              }
              await api.requestCode(phone, birthDate);
              setStep({ name: 'code', phone });
            })
          }
        >
          <label>
            Celular com DDD
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+55 11 91234-5678"
              required
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
            />
          </label>
        </Form>
      );

    case 'code':
      return (
        // TODO(copy): revisar
        <Form
          title="Digita o código que chegou no WhatsApp"
          submitLabel="Entrar"
          busy={busy}
          error={error}
          onSubmit={() =>
            run(async () => {
              if (!loginCodeSchema.safeParse(code).success) {
                setError('O código tem 6 números.'); // TODO(copy): revisar
                return;
              }
              const result = await api.verifyCode(step.phone, code);
              if (result.status === 'logged_in') onLoggedIn();
              else setStep({ name: 'nickname', registrationToken: result.registrationToken });
            })
          }
        >
          <label>
            Código
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
          </label>
        </Form>
      );

    case 'nickname':
      return (
        // TODO(copy): revisar
        <Form
          title="Como a galera te chama?"
          submitLabel="Pronto"
          busy={busy}
          error={error}
          onSubmit={() =>
            run(async () => {
              if (!nicknameSchema.safeParse(nickname).success) {
                setError('O apelido pode ter até 30 letras.'); // TODO(copy): revisar
                return;
              }
              await api.register(step.registrationToken, nickname.trim(), birthDate);
              onLoggedIn();
            })
          }
        >
          <label>
            Apelido
            <input
              maxLength={30}
              required
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
        </Form>
      );
  }
}
