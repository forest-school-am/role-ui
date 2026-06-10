import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../api/users';

interface SuperuserContextValue {
  isSuperuser: boolean;
  superuserModeActive: boolean;
  setSuperuserModeActive: (active: boolean) => void;
}

const SuperuserContext = createContext<SuperuserContextValue>({
  isSuperuser: false,
  superuserModeActive: false,
  setSuperuserModeActive: () => undefined,
});

export const SuperuserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe });

  const [superuserModeActive, setSuperuserModeActiveState] = useState(
    () => sessionStorage.getItem('superuser_mode') === 'true',
  );

  const isSuperuser = me?.is_superuser ?? false;

  // If the user loses superuser status, deactivate superuser mode.
  useEffect(() => {
    if (!isSuperuser && superuserModeActive) {
      setSuperuserModeActiveState(false);
      sessionStorage.removeItem('superuser_mode');
    }
  }, [isSuperuser, superuserModeActive]);

  const setSuperuserModeActive = useCallback(
    (active: boolean) => {
      if (!isSuperuser) return;
      setSuperuserModeActiveState(active);
      if (active) {
        sessionStorage.setItem('superuser_mode', 'true');
      } else {
        sessionStorage.removeItem('superuser_mode');
      }
    },
    [isSuperuser],
  );

  return (
    <SuperuserContext.Provider value={{ isSuperuser, superuserModeActive, setSuperuserModeActive }}>
      {children}
    </SuperuserContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useSuperuser() {
  return useContext(SuperuserContext);
}
