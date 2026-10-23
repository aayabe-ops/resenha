import { birthDateSchema, isUnderMinAge, nicknameSchema } from '@resenha/shared';
import { useState } from 'react';
import { api, errorMessage } from '../api';
import { Form } from './Form';

// Convidado sem conta (ACE-01): nascimento primeiro (ACE-03), depois apelido.
// A foto depende da questão em aberto #4. TODO(copy): revisar
export function GuestEntry({ onEntered }: { onEntered: () => void }) {
  const [step, setStep] = useState<'birthDate' | 'underAge' | 'nickname'>('birthDate');
  const [birthDate, setBirthDate] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'underAge') {
    return <p>A Resenha é só para quem tem 15 anos ou mais. Nenhum dado seu foi guardado.</p>;
  }

  if (step === 'birthDate') {
    return (
      <Form
        title="Quando você nasceu?"
        submitLabel="Continuar"
        busy={false}
        error={error}
        onSubmit={() => {
          if (!birthDateSchema.safeParse(birthDate).success) {
            setError('Coloca uma data válida.');
            return;
          }
          setError(null);
          setStep(isUnderMinAge(birthDate) ? 'underAge' : 'nickname');
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
  }

  return (
    <Form
      title="Como a galera te chama?"
      submitLabel="Entrar na resenha"
      busy={busy}
      error={error}
      onSubmit={() => {
        if (!nicknameSchema.safeParse(nickname).success) {
          setError('O apelido pode ter até 30 letras.');
          return;
        }
        setBusy(true);
        setError(null);
        api.createGuest(nickname.trim(), birthDate).then(onEntered, (failure: unknown) => {
          setError(errorMessage(failure));
          setBusy(false);
        });
      }}
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
