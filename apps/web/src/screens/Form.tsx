import type { FormEvent, ReactNode } from 'react';

interface FormProps {
  title: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  children: ReactNode;
}

/** Formulário de uma etapa, com erro anunciado para leitor de tela. */
export function Form({ title, submitLabel, busy, error, onSubmit, children }: FormProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <form onSubmit={handleSubmit}>
      <h2>{title}</h2>
      {children}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
