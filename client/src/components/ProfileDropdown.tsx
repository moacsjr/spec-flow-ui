import { useEffect, useRef, useState } from 'react';
import { redirectToLogout } from '../auth/cognito';
import { useSession } from '../hooks/useSession';

// Dropdown do menu de perfil (Story #70 / Task #71 + #73; logout na Story #74).
//
// Componente controlado: o pai (`ProfileMenu`) mantém o estado de abertura e
// passa `isOpen`/`onClose`. Exibe os dados obrigatórios do RN004 — nome do
// usuário, tenant-id, tenant-name — e um botão de logout (RN006).
//
// Fechamento ao clicar fora (Task #71) via `useRef` + `useEffect`. Acessibilidade
// (Task #73): `role="menu"` + `aria-labelledby`, itens acionáveis com
// `role="menuitem"`, foco no primeiro item ao abrir, navegação por ↑/↓/Home/End
// e fechamento por ESC devolvendo o foco ao gatilho.
//
// Logout (Story #74): o botão aciona `logout` do `useSession` (revoga a sessão
// no servidor e limpa o estado local), mostra um estado de carregamento enquanto
// a requisição corre (Task #76) e, ao concluir, redireciona para o login. Erros
// são informados inline sem fechar o dropdown (Task #77).

export interface ProfileUserData {
  name: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface ProfileTenantData {
  id: string;
  name: string;
}

interface ProfileDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fecha e devolve o foco ao gatilho (ESC / clique em item). */
  onCloseAndRestoreFocus: () => void;
  userData: ProfileUserData;
  /** Tenant ativo; `null` quando os dados estão indisponíveis (CE002). */
  tenantData: ProfileTenantData | null;
  /** `id` do dropdown, referenciado pelo `aria-controls` do gatilho. */
  id?: string;
  /** `id` do gatilho, usado como `aria-labelledby` do menu. */
  labelledBy?: string;
}

// CE002: sem dados de tenant, mostramos um placeholder e mantemos o logout.
const TENANT_FALLBACK = '[Dados não disponíveis]';

// Trata string vazia/em branco como ausente (ex.: tenant sem nome no registro).
function orFallback(value: string | undefined): string {
  return value && value.trim() ? value : TENANT_FALLBACK;
}

export function ProfileDropdown({
  isOpen,
  onClose,
  onCloseAndRestoreFocus,
  userData,
  tenantData,
  id,
  labelledBy,
}: ProfileDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { logout } = useSession();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // Fecha ao clicar fora do dropdown. Só escuta enquanto está aberto.
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    // `mousedown` (e não `click`) evita reabrir/fechar em conflito com o toggle
    // do gatilho e fecha antes de um eventual clique em outro controle.
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, onClose]);

  // Ao abrir, move o foco para o primeiro item acionável do menu (a11y).
  useEffect(() => {
    if (!isOpen) return;
    menuItems()[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Itens navegáveis do menu (apenas os acionáveis).
  function menuItems(): HTMLElement[] {
    if (!ref.current) return [];
    return Array.from(ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  function focusItem(index: number) {
    const items = menuItems();
    if (items.length === 0) return;
    const clamped = (index + items.length) % items.length;
    items[clamped].focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    const current = items.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onCloseAndRestoreFocus();
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      default:
        break;
    }
  }

  if (!isOpen) return null;

  const tenantId = orFallback(tenantData?.id);
  const tenantName = orFallback(tenantData?.name);

  // Fluxo de logout (Task #76 + #77): desabilita o botão e mostra carregamento
  // enquanto revoga a sessão; ao concluir, redireciona para o login. Em caso de
  // erro na revogação, o estado local já foi limpo por `logout` (evita sessão
  // inconsistente) — informamos o usuário inline e ainda assim redirecionamos
  // para o login, encerrando a sessão de forma segura.
  const handleLogout = async () => {
    if (isLoggingOut) return;
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      await logout();
      redirectToLogout();
    } catch {
      setLogoutError('Não foi possível encerrar a sessão no servidor. Encerrando a sessão local e redirecionando…');
      redirectToLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div
      ref={ref}
      className="profile-dropdown"
      id={id}
      role="menu"
      aria-labelledby={labelledBy}
      onKeyDown={handleKeyDown}
    >
      <ul className="profile-dropdown__list">
        <li className="profile-dropdown__header">
          <span className="profile-dropdown__name">{userData.name}</span>
          {userData.email && (
            <span className="profile-dropdown__email">{userData.email}</span>
          )}
        </li>

        <li className="profile-dropdown__info">
          <span className="profile-dropdown__label">tenant-id</span>
          <span className="profile-dropdown__value">{tenantId}</span>
        </li>

        <li className="profile-dropdown__info">
          <span className="profile-dropdown__label">tenant-name</span>
          <span className="profile-dropdown__value">{tenantName}</span>
        </li>

        <li className="profile-dropdown__footer">
          <button
            type="button"
            className="profile-dropdown__logout"
            role="menuitem"
            onClick={handleLogout}
            disabled={isLoggingOut}
            aria-busy={isLoggingOut}
          >
            {isLoggingOut ? (
              <>
                <span className="profile-dropdown__spinner" aria-hidden="true" />
                Saindo…
              </>
            ) : (
              'Sair'
            )}
          </button>
          {logoutError && (
            <p className="profile-dropdown__error" role="alert">
              {logoutError}
            </p>
          )}
        </li>
      </ul>
    </div>
  );
}
