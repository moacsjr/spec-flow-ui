// Formulário de repositório — cobre o cadastro (#/repositories/new) e a edição
// (#/repositories/:id/edit). Coleta a URL do repositório e, opcionalmente, a URL
// do Projects v2 — quando informada, o backend introspecta o projeto (campo de
// etapa + opções) para habilitar mover a Feature de etapa pela UI.
//
// Na edição, pré-carrega os valores atuais; esvaziar o campo de Projects v2 e
// salvar desvincula o projeto.

import { useEffect, useState } from 'react';
import { createRepository, fetchRepository, updateRepository } from '../data/repositories';
import { fetchMe, saveMySlackId } from '../data/workspace';
import { DASHBOARD_HREF } from '../lib/router';

interface RepositoryFormPageProps {
  repoId?: string; // presente = edição
}

type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready' };

export function RepositoryFormPage({ repoId }: RepositoryFormPageProps) {
  const isEdit = repoId != null;

  const [load, setLoad] = useState<Load>(isEdit ? { phase: 'loading' } : { phase: 'ready' });
  const [url, setUrl] = useState('');
  const [projectUrl, setProjectUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Discussão integrada (Slack) — só na edição: token write-only por repo +
  // Slack member ID do usuário (convite automático ao canal).
  const [slackConfigured, setSlackConfigured] = useState(false);
  const [slackToken, setSlackToken] = useState('');
  const [slackRemove, setSlackRemove] = useState(false);
  const [slackUserId, setSlackUserId] = useState('');
  const [slackUserIdInitial, setSlackUserIdInitial] = useState('');
  const [wip, setWip] = useState(''); // WIP pessoal do dev (vazio = default 2)

  // Edição: carrega os valores atuais para pré-preencher.
  useEffect(() => {
    if (repoId == null) return;
    const controller = new AbortController();
    setLoad({ phase: 'loading' });
    fetchRepository(repoId, controller.signal)
      .then((repo) => {
        if (controller.signal.aborted) return;
        setUrl(repo.url);
        setProjectUrl(repo.projectUrl ?? '');
        setSlackConfigured(Boolean(repo.slackConfigured));
        setWip(repo.wipThreshold != null ? String(repo.wipThreshold) : '');
        setLoad({ phase: 'ready' });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [repoId]);

  // Slack member ID do usuário (preferência pessoal, não do repo).
  useEffect(() => {
    if (!isEdit) return;
    fetchMe()
      .then((me) => {
        setSlackUserId(me.slackUserId ?? '');
        setSlackUserIdInitial(me.slackUserId ?? '');
      })
      .catch(() => undefined);
  }, [isEdit]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || url.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (repoId != null) {
        // projectUrl vazio desvincula o projeto (o backend trata '' como limpar).
        // slackBotToken só é enviado quando o usuário digitou um novo ou pediu remoção.
        await updateRepository(repoId, {
          url: url.trim(),
          projectUrl: projectUrl.trim(),
          wipThreshold: wip.trim() ? Number(wip) : null,
          ...(slackRemove
            ? { slackBotToken: '' }
            : slackToken.trim()
              ? { slackBotToken: slackToken.trim() }
              : {}),
        });
        if (slackUserId.trim() !== slackUserIdInitial) {
          await saveMySlackId(slackUserId.trim() || null);
        }
      } else {
        await createRepository({ url: url.trim(), projectUrl: projectUrl.trim() || undefined });
      }
      window.location.hash = DASHBOARD_HREF; // volta ao dashboard
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const title = isEdit ? 'Editar repositório' : 'Conectar repositório';

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <span className="brand" aria-hidden="true" />
          <nav className="breadcrumb" aria-label="Navegação">
            <a className="breadcrumb__seg" href={DASHBOARD_HREF}>
              Dashboard
            </a>
            <span className="breadcrumb__seg breadcrumb__seg--current">
              {isEdit ? 'Editar repositório' : 'Novo repositório'}
            </span>
          </nav>
        </div>
      </header>

      <main className="page">
        <div className="dashboard__head">
          <h1 className="dashboard__title">{title}</h1>
        </div>

        {load.phase === 'loading' && (
          <div className="repo-form" aria-busy="true">
            <div className="skeleton skeleton-card" />
          </div>
        )}

        {load.phase === 'error' && (
          <div className="repo-empty">
            <div className="repo-empty__art" aria-hidden="true">
              ⚠️
            </div>
            <p className="repo-empty__title">Não foi possível carregar o repositório.</p>
            <p>
              <code>{load.message}</code>
            </p>
            <a className="btn btn--accent" href={DASHBOARD_HREF}>
              Voltar ao Dashboard
            </a>
          </div>
        )}

        {load.phase === 'ready' && (
          <form className="repo-form" onSubmit={onSubmit}>
            <label className="repo-form__field">
              <span className="repo-form__label">URL do repositório</span>
              <input
                type="url"
                className="repo-form__input"
                placeholder="https://github.com/owner/repo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                autoFocus
              />
            </label>

            <label className="repo-form__field">
              <span className="repo-form__label">
                Projects v2 <span className="repo-form__optional">(opcional)</span>
              </span>
              <input
                type="url"
                className="repo-form__input"
                placeholder="https://github.com/orgs/<org>/projects/<n>"
                value={projectUrl}
                onChange={(e) => setProjectUrl(e.target.value)}
              />
              <span className="repo-form__hint">
                Necessário para mover a Feature de etapa (📋 Spec / 📋 Plan) pela UI. O servidor
                descobre o campo de etapa e suas opções automaticamente.
                {isEdit && ' Deixe em branco para desvincular o projeto.'}
              </span>
            </label>

            {isEdit && (
              <>
                <label className="repo-form__field">
                  <span className="repo-form__label">
                    WIP pessoal do Developer <span className="repo-form__optional">(opcional)</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="repo-form__input"
                    placeholder="2 (default)"
                    value={wip}
                    onChange={(e) => setWip(e.target.value)}
                  />
                  <span className="repo-form__hint">
                    Itens em andamento por dev a partir dos quais o Start pede confirmação leve
                    (nunca bloqueia). Vazio = default 2.
                  </span>
                </label>

                <label className="repo-form__field">
                  <span className="repo-form__label">
                    Slack — discussão integrada{' '}
                    <span className="repo-form__optional">
                      ({slackConfigured ? 'configurado' : 'opcional'})
                    </span>
                  </span>
                  <input
                    type="password"
                    className="repo-form__input"
                    placeholder={
                      slackConfigured
                        ? 'configurado — cole um novo bot token para substituir'
                        : 'xoxb-… (bot token com channels:manage, chat:write, channels:read)'
                    }
                    value={slackToken}
                    onChange={(e) => setSlackToken(e.target.value)}
                    disabled={slackRemove}
                    autoComplete="off"
                  />
                  <span className="repo-form__hint">
                    Habilita o botão "Discutir no chat" nos comentários de revisão — um canal por
                    Feature, criado sob demanda.
                  </span>
                  {slackConfigured && (
                    <span className="repo-form__inlinecheck">
                      <input
                        type="checkbox"
                        checked={slackRemove}
                        onChange={(e) => setSlackRemove(e.target.checked)}
                      />{' '}
                      Remover a integração
                    </span>
                  )}
                </label>

                <label className="repo-form__field">
                  <span className="repo-form__label">
                    Seu Slack member ID <span className="repo-form__optional">(opcional)</span>
                  </span>
                  <input
                    type="text"
                    className="repo-form__input"
                    placeholder="U0XXXXXXX — perfil → ⋯ → Copy member ID"
                    value={slackUserId}
                    onChange={(e) => setSlackUserId(e.target.value)}
                  />
                  <span className="repo-form__hint">
                    Preferência pessoal (vale para todos os repositórios): você é adicionado
                    automaticamente aos canais que criar. Sem o ID, o canal é criado do mesmo jeito.
                  </span>
                </label>
              </>
            )}

            {error && (
              <p className="edit-error" role="alert">
                {error}
              </p>
            )}

            <div className="repo-form__actions">
              <button
                type="submit"
                className="btn btn--accent"
                disabled={submitting || url.trim().length === 0}
              >
                {submitting
                  ? isEdit
                    ? 'Salvando…'
                    : 'Cadastrando…'
                  : isEdit
                    ? 'Salvar'
                    : 'Cadastrar'}
              </button>
              <a className="btn" href={DASHBOARD_HREF}>
                Cancelar
              </a>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
