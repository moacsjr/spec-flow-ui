// Identidade GitHub da sessão (workspace do Developer). O backend guarda o
// vínculo usuário → login do GitHub (GET/PUT /api/me); aqui cacheamos em nível
// de módulo com subscribers para todos os consumidores (topbar + páginas)
// enxergarem a mesma identidade e reagirem juntos ao vínculo.

import { useEffect, useState } from 'react';
import { fetchMe, saveMyLogin, type Me } from '../data/workspace';

let cached: Me | null = null;
let pending: Promise<Me> | null = null;
const subscribers = new Set<(me: Me | null) => void>();

function broadcast(): void {
  for (const fn of subscribers) fn(cached);
}

function load(): Promise<Me> {
  pending ??= fetchMe()
    .then((me) => {
      cached = me;
      broadcast();
      return me;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export interface UseMe {
  me: Me | null; // null = ainda carregando (ou falha — retry no próximo mount)
  setLogin: (login: string | null) => Promise<void>;
}

export function useMe(): UseMe {
  const [me, setMe] = useState<Me | null>(cached);

  useEffect(() => {
    subscribers.add(setMe);
    if (!cached) load().catch(() => undefined);
    return () => {
      subscribers.delete(setMe);
    };
  }, []);

  const setLogin = async (login: string | null): Promise<void> => {
    const saved = await saveMyLogin(login);
    if (cached) cached = { ...cached, login: saved };
    broadcast();
  };

  return { me, setLogin };
}
