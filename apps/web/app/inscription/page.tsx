'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, signup } from '@/lib/api';

const inputClass =
  'rounded-xs border border-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-muted-foreground';

export default function InscriptionPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup({ email, password, ageConfirmed, consentAccepted });
      router.push('/chat');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue, réessayez.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-sm rounded-sm bg-surface p-8">
        <h1 className="text-heading font-bold">Créer un compte</h1>

        <form aria-label="Créer un compte" className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-caption font-semibold">
              Adresse e-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-caption font-semibold">
              Mot de passe
            </label>
            <p className="text-caption text-muted-foreground">
              Au moins 8 caractères, avec assez de variété (lettres, chiffres, symboles) — ou une phrase de passe
              longue.
            </p>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-sm border border-border p-3">
            <label className="flex items-start gap-2 text-caption">
              <input
                type="checkbox"
                required
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.target.checked)}
                className="mt-0.5 size-4"
              />
              J&apos;accepte les conditions d&apos;utilisation
            </label>
            <label className="flex items-start gap-2 text-caption">
              <input
                type="checkbox"
                required
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
                className="mt-0.5 size-4"
              />
              Je certifie avoir 18 ans ou plus
            </label>
          </div>

          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="mt-1">
            {submitting ? 'Création…' : 'Créer mon compte'}
          </Button>
          <p className="text-center text-caption text-muted-foreground">
            Déjà un compte ?{' '}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
