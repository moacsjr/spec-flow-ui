// Tela de login própria (design "SpecWave Login" — Claude Design), adaptada ao
// design system do app (tokens terracota/base quente; a paleta do handoff foi
// mapeada para os tokens existentes). Fala direto com o user pool do Cognito
// (auth/cognito.ts); o Hosted UI só entra na federação Google.
//
// Modos do painel direito (o painel de marca é constante):
//   signin  → e-mail/senha (com "manter conectado" e mostrar/ocultar)
//   newpass → NEW_PASSWORD_REQUIRED (primeiro acesso de convidado)
//   forgot / forgot2 → esqueci a senha (código por e-mail + nova senha)
//   signup / signup2 → solicitar acesso (cadastro + confirmação por código)

import { useState, type FormEvent } from 'react';
import '../styles/login.css';
import {
  CognitoError,
  completeNewPassword,
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  googleEnabled,
  loginWithGoogle,
  resendConfirmationCode,
  signInWithPassword,
  signUp,
} from '../auth/cognito';

type Mode = 'signin' | 'newpass' | 'forgot' | 'forgot2' | 'signup' | 'signup2';

const MODE_TITLES: Record<Mode, { title: string; hint: string }> = {
  signin: { title: 'Entrar', hint: 'Acesse seu workspace para continuar.' },
  newpass: { title: 'Defina sua senha', hint: 'Primeiro acesso — escolha uma senha nova.' },
  forgot: { title: 'Recuperar senha', hint: 'Enviaremos um código para o seu e-mail.' },
  forgot2: { title: 'Redefinir senha', hint: 'Digite o código recebido e a nova senha.' },
  signup: { title: 'Solicitar acesso', hint: 'Crie sua conta com e-mail e senha.' },
  signup2: { title: 'Confirmar e-mail', hint: 'Digite o código que enviamos para o seu e-mail.' },
};

function friendlyError(err: unknown): string {
  if (err instanceof CognitoError) {
    switch (err.code) {
      case 'NotAuthorizedException':
      case 'UserNotFoundException':
        return 'E-mail ou senha incorretos. Tente novamente.';
      case 'InvalidPasswordException':
        return 'Senha fraca — use ao menos 8 caracteres com maiúsculas, minúsculas e números.';
      case 'CodeMismatchException':
        return 'Código inválido. Confira o e-mail e tente de novo.';
      case 'ExpiredCodeException':
        return 'Código expirado — solicite um novo.';
      case 'UsernameExistsException':
        return 'Este e-mail já tem uma conta. Entre ou recupere a senha.';
      case 'LimitExceededException':
      case 'TooManyRequestsException':
        return 'Muitas tentativas — aguarde alguns minutos.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [session, setSession] = useState(''); // NEW_PASSWORD_REQUIRED
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const enterApp = () => window.location.reload(); // bootstrap acha o token e renderiza o App

  const run = (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    fn()
      .catch((err: unknown) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (mode === 'signin') {
      if (!email || !password) {
        setError('Informe e-mail e senha.');
        return;
      }
      run(async () => {
        try {
          const r = await signInWithPassword(email.trim(), password, remember);
          if ('challenge' in r) {
            setSession(r.session);
            setNewPassword('');
            setMode('newpass');
            return;
          }
          enterApp();
        } catch (err) {
          if (err instanceof CognitoError && err.code === 'UserNotConfirmedException') {
            await resendConfirmationCode(email.trim()).catch(() => undefined);
            setCode('');
            setMode('signup2');
            setNotice('Conta ainda não confirmada — reenviamos o código para o seu e-mail.');
            return;
          }
          throw err;
        }
      });
    } else if (mode === 'newpass') {
      run(async () => {
        await completeNewPassword(email.trim(), newPassword, session, remember);
        enterApp();
      });
    } else if (mode === 'forgot') {
      run(async () => {
        await forgotPassword(email.trim());
        setCode('');
        setNewPassword('');
        setMode('forgot2');
        setNotice('Código enviado — confira o seu e-mail.');
      });
    } else if (mode === 'forgot2') {
      run(async () => {
        await confirmForgotPassword(email.trim(), code.trim(), newPassword);
        setPassword('');
        setMode('signin');
        setNotice('Senha redefinida — entre com a nova senha.');
      });
    } else if (mode === 'signup') {
      run(async () => {
        await signUp(email.trim(), password);
        setCode('');
        setMode('signup2');
        setNotice('Enviamos um código de confirmação para o seu e-mail.');
      });
    } else if (mode === 'signup2') {
      run(async () => {
        await confirmSignUp(email.trim(), code.trim());
        const r = await signInWithPassword(email.trim(), password, remember).catch(() => null);
        if (r && 'ok' in r) {
          enterApp();
          return;
        }
        setMode('signin');
        setNotice('E-mail confirmado — entre com a sua senha.');
      });
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const { title, hint } = MODE_TITLES[mode];
  const submitLabel = loading
    ? 'Entrando…'
    : mode === 'signin'
      ? 'Entrar'
      : mode === 'forgot'
        ? 'Enviar código'
        : mode === 'forgot2'
          ? 'Redefinir senha'
          : mode === 'signup'
            ? 'Criar conta'
            : mode === 'signup2'
              ? 'Confirmar'
              : 'Salvar e entrar';

  return (
    <div className="lg">
      {/* Painel esquerdo: marca */}
      <div className="lg-brand">
        <div className="lg-brand__top">
          <div className="lg-brand__logo">
            <span className="lg-brand__mark" aria-hidden="true" />
            <span className="lg-brand__name">SpecWave</span>
          </div>
          <div className="lg-brand__hero">
            <h1>AI Product Engineering</h1>
            <span className="lg-brand__tagline">Dream → Spec → Plan → Build</span>
          </div>
        </div>
        <span className="lg-brand__copy">© 2026 SpecWave</span>
      </div>

      {/* Painel direito: formulário */}
      <div className="lg-panel">
        <form className="lg-form" onSubmit={onSubmit}>
          <div className="lg-form__head">
            <h2>{title}</h2>
            <span>{hint}</span>
          </div>

          {mode === 'signin' && googleEnabled && (
            <>
              <button
                type="button"
                className="lg-google"
                disabled={loading}
                onClick={() => loginWithGoogle()}
              >
                <span className="lg-google__icon" aria-hidden="true" />
                Continuar com Google
              </button>
              <div className="lg-divider">
                <span />
                <em>ou com e-mail</em>
                <span />
              </div>
            </>
          )}

          {mode !== 'newpass' && (
            <div className="lg-field">
              <label htmlFor="lg-email">E-mail</label>
              <input
                id="lg-email"
                type="email"
                placeholder="voce@empresa.com"
                value={email}
                autoComplete="email"
                autoFocus={mode === 'signin'}
                disabled={loading || mode === 'forgot2' || mode === 'signup2'}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </div>
          )}

          {(mode === 'forgot2' || mode === 'signup2') && (
            <div className="lg-field">
              <label htmlFor="lg-code">Código de verificação</label>
              <input
                id="lg-code"
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                autoFocus
                disabled={loading}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
              />
            </div>
          )}

          {(mode === 'signin' || mode === 'signup') && (
            <div className="lg-field">
              <div className="lg-field__row">
                <label htmlFor="lg-senha">Senha</label>
                {mode === 'signin' && (
                  <button type="button" className="lg-link" onClick={() => switchMode('forgot')}>
                    Esqueci minha senha
                  </button>
                )}
              </div>
              <div className="lg-pw">
                <input
                  id="lg-senha"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  disabled={loading}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                />
                <button type="button" className="lg-pw__toggle" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>
          )}

          {(mode === 'newpass' || mode === 'forgot2') && (
            <div className="lg-field">
              <label htmlFor="lg-nova">Nova senha</label>
              <div className="lg-pw">
                <input
                  id="lg-nova"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={newPassword}
                  autoComplete="new-password"
                  autoFocus={mode === 'newpass'}
                  disabled={loading}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError(null);
                  }}
                />
                <button type="button" className="lg-pw__toggle" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="lg-error">
              <b>!</b> {error}
            </div>
          )}
          {notice && <div className="lg-notice">{notice}</div>}

          {mode === 'signin' && (
            <label className="lg-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Manter conectado
            </label>
          )}

          <button type="submit" className="lg-submit" disabled={loading}>
            {submitLabel}
          </button>

          {mode === 'signin' ? (
            <span className="lg-foot">
              Não tem uma conta?{' '}
              <button type="button" className="lg-link" onClick={() => switchMode('signup')}>
                Solicitar acesso
              </button>
            </span>
          ) : (
            <span className="lg-foot">
              <button type="button" className="lg-link" onClick={() => switchMode('signin')}>
                ← Voltar ao login
              </button>
            </span>
          )}
        </form>
      </div>
    </div>
  );
}
