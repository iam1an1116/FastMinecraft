import { useState, useEffect } from 'react';

export type UserRole = 'host' | 'player';

const ROLE_STORAGE_KEY = 'fm_user_role';
const ROLE_CHANGE_EVENT = 'fm_role_changed';

export function getStoredRole(): UserRole | null {
  const val = localStorage.getItem(ROLE_STORAGE_KEY);
  if (val === 'host' || val === 'player') return val;
  return null;
}

export function setStoredRole(role: UserRole) {
  localStorage.setItem(ROLE_STORAGE_KEY, role);
  window.dispatchEvent(new CustomEvent(ROLE_CHANGE_EVENT, { detail: role }));
}

export function useRole() {
  const [role, setRoleState] = useState<UserRole | null>(() => getStoredRole());

  useEffect(() => {
    const handleRoleChange = (e: Event) => {
      const customEvent = e as CustomEvent<UserRole>;
      setRoleState(customEvent.detail);
    };

    window.addEventListener(ROLE_CHANGE_EVENT, handleRoleChange);
    return () => window.removeEventListener(ROLE_CHANGE_EVENT, handleRoleChange);
  }, []);

  const switchRole = (newRole: UserRole) => {
    setStoredRole(newRole);
  };

  return { role, switchRole };
}
