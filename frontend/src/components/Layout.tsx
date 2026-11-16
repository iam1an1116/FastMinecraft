import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useRole } from '../lib/role';
import { DesktopHeader } from './DesktopHeader';
import { RoleOnboarding } from './RoleOnboarding';
import { PlayerModePage } from '../pages/PlayerModePage';

export interface ServerInfo {
  id: string;
  name: string;
  version: string;
  server_type: string;
  port: number;
  status: string;
  max_memory: number;
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, switchRole } = useRole();

  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [currentServer, setCurrentServer] = useState<ServerInfo | null>(null);

  // Match /server/:id
  const serverId = location.pathname.match(/^\/server\/([^/]+)/)?.[1] || null;

  useEffect(() => {
    loadServers();
    const interval = setInterval(loadServers, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (serverId) {
      const found = servers.find(s => s.id === serverId);
      setCurrentServer(found || null);
    } else {
      setCurrentServer(null);
    }
  }, [serverId, servers]);

  async function loadServers() {
    try {
      const data = await api.getServers();
      setServers(data);
    } catch {}
  }

  const handleRoleChange = (newRole: 'host' | 'player') => {
    switchRole(newRole);
    if (newRole === 'player') {
      navigate('/player');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-white/80 backdrop-blur-3xl rounded-[28px] border border-white/60 shadow-2xl relative select-none">
      {/* Onboarding Dialog if no role is chosen */}
      {!role && <RoleOnboarding onSelect={handleRoleChange} />}

      {/* Frosted Glass Header */}
      <DesktopHeader
        currentRole={role || 'host'}
        onRoleSwitch={handleRoleChange}
        serverName={currentServer?.name}
      />

      {/* Main Content Area with Page Transition */}
      <main className="flex-1 overflow-auto bg-transparent flex flex-col relative page-enter">
        {role === 'player' ? (
          <PlayerModePage />
        ) : (
          <Outlet context={{ servers, onServersRefresh: loadServers }} />
        )}
      </main>
    </div>
  );
}
