import { useRef, useState } from 'react';
import { useActiveTenant } from '../hooks/useActiveTenant';
import { useUserProfile } from '../hooks/useUserProfile';
import { ProfileDropdown } from './ProfileDropdown';
import { UserAvatar } from './UserAvatar';

// Menu de perfil no cabeçalho (Story #70 / Task #72 + #73).
//
// Componente principal: mantém o estado de abertura do dropdown, usa o
// `UserAvatar` como gatilho clicável e renderiza o `ProfileDropdown`
// condicionalmente. Os dados vêm de `useUserProfile` (usuário) e
// `useActiveTenant` (tenant ativo). Só aparece para usuários autenticados
// (RN001).
//
// Acessibilidade (Task #73): o gatilho expõe `aria-expanded`/`aria-controls`/
// `aria-haspopup`; Enter/Espaço alternam o menu (comportamento nativo do
// button) e ↓/↑ abrem o menu já com o foco no primeiro item. O fechamento por
// ESC devolve o foco ao gatilho.

const DROPDOWN_ID = 'profile-dropdown';
const TRIGGER_ID = 'profile-menu-trigger';

export function ProfileMenu() {
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const { authenticated, profile } = useUserProfile();
  const { tenant } = useActiveTenant();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // RN001: menu só para autenticados.
  if (!authenticated || !profile) return null;

  const close = () => setDropdownOpen(false);
  const toggle = () => setDropdownOpen((open) => !open);

  // Devolve o foco ao gatilho ao fechar via ESC/clique em item (a11y).
  const closeAndRestoreFocus = () => {
    close();
    triggerRef.current?.focus();
  };

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    // ↓/↑ abrem o menu; o ProfileDropdown foca o primeiro item ao montar.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setDropdownOpen(true);
    }
  }

  return (
    <div className="profile-menu">
      <button
        ref={triggerRef}
        id={TRIGGER_ID}
        type="button"
        className="profile-trigger"
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
        aria-label={`Menu de perfil de ${profile.name}`}
        aria-haspopup="menu"
        aria-expanded={isDropdownOpen}
        aria-controls={DROPDOWN_ID}
      >
        <UserAvatar user={profile} size={30} />
      </button>

      <ProfileDropdown
        id={DROPDOWN_ID}
        labelledBy={TRIGGER_ID}
        isOpen={isDropdownOpen}
        onClose={close}
        onCloseAndRestoreFocus={closeAndRestoreFocus}
        userData={profile}
        tenantData={tenant}
      />
    </div>
  );
}
