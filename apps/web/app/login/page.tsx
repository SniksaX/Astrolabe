'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, login } from '@/lib/api';

const inputClass =
  'rounded-xs border border-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-muted-foreground';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
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
        <h1 className="text-heading font-bold">Se connecter</h1>

        <form aria-label="Se connecter" className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
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
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="mt-1">
            {submitting ? 'Connexion…' : 'Se connecter'}
          </Button>
          <p className="text-center text-caption text-muted-foreground">
            Pas encore de compte ?{' '}
            <Link href="/inscription" className="font-semibold text-primary hover:underline">
              Créer un compte
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
