import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Terminal, Users, Box, Archive, SlidersHorizontal, ShoppingBag, Wifi, Settings } from 'lucide-react';
import { UserRole } from '../lib/role';

interface DesktopHeaderProps {
  currentRole: UserRole;
  onRoleSwitch: (newRole: UserRole) => void;
  serverName?: string;
}

export function DesktopHeader({ currentRole, onRoleSwitch, serverName }: DesktopHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Match /server/:id or /server/:id/subpath
  const serverMatch = location.pathname.match(/^\/server\/([^/]+)(?:\/([^/]+))?/);
  const serverId = serverMatch?.[1];
  const subRoute = serverMatch?.[2] || '';

  const isServerDetail = Boolean(serverId);

  const mainNavItems = [
    { label: '市场', to: '/market', icon: ShoppingBag, active: location.pathname === '/market' },
    { label: '联机', to: '/network', icon: Wifi, active: location.pathname === '/network' },
    { label: '设置', to: '/settings', icon: Settings, active: location.pathname === '/settings' },
  ];

  const serverSubNavItems = serverId ? [
    { label: '控制台', to: `/server/${serverId}`, icon: Terminal, active: !subRoute },
    { label: '玩家', to: `/server/${serverId}/players`, icon: Users, active: subRoute === 'players' },
    { label: 'Mod', to: `/server/${serverId}/mods`, icon: Box, active: subRoute === 'mods' },
    { label: '备份', to: `/server/${serverId}/backup`, icon: Archive, active: subRoute === 'backup' },
    { label: '配置', to: `/server/${serverId}/settings`, icon: SlidersHorizontal, active: subRoute === 'settings' },
  ] : [];

  return (
    <header
      className="h-14 w-full flex items-center justify-between pl-20 pr-6 bg-white/40 backdrop-blur-md flex-shrink-0 z-30 transition-colors select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left Navigation Area */}
      <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {currentRole === 'host' ? (
          <>
            {isServerDetail ? (
              // In Server Detail: "Back" + Sub-Nav Tabs (Transparent & Gray Active, No Dividers)
              <div className="flex items-center gap-2 animate-fade-in">
                <button
                  onClick={() => navigate('/')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-transparent hover:bg-black/[0.05] text-neutral-800 text-xs font-semibold transition-all active:scale-95"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回</span>
                </button>

                {serverName && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-black/[0.04] text-neutral-600">
                    {serverName}
                  </span>
                )}

                <div className="flex items-center gap-1">
                  {serverSubNavItems.map(item => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all ${
                          item.active
                            ? 'bg-black/[0.08] text-neutral-900 font-semibold'
                            : 'bg-transparent text-neutral-600 hover:text-neutral-900 hover:bg-black/[0.04]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              // Main Host Navigation (Transparent & Gray Active, No Dividers)
              <div className="flex items-center gap-1">
                <Link
                  to="/"
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs transition-all ${
                    location.pathname === '/'
                      ? 'bg-black/[0.08] text-neutral-900 font-semibold'
                      : 'bg-transparent text-neutral-600 hover:text-neutral-900 hover:bg-black/[0.04]'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>控制台</span>
                </Link>

                {mainNavItems.map(item => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs transition-all ${
                        item.active
                          ? 'bg-black/[0.08] text-neutral-900 font-semibold'
                          : 'bg-transparent text-neutral-600 hover:text-neutral-900 hover:bg-black/[0.04]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="text-xs font-semibold tracking-wide text-neutral-800 px-2">
            玩家联机
          </div>
        )}
      </div>

      {/* Right Area: Mode Switch (Transparent & Gray Active) */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center bg-black/[0.04] p-0.5 rounded-full">
          <button
            onClick={() => onRoleSwitch('host')}
            className={`px-3 py-1 rounded-full text-xs transition-all ${
              currentRole === 'host'
                ? 'bg-black/[0.08] text-neutral-900 font-semibold'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800 hover:bg-black/[0.03]'
            }`}
          >
            服主
          </button>
          <button
            onClick={() => onRoleSwitch('player')}
            className={`px-3 py-1 rounded-full text-xs transition-all ${
              currentRole === 'player'
                ? 'bg-black/[0.08] text-neutral-900 font-semibold'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800 hover:bg-black/[0.03]'
            }`}
          >
            玩家
          </button>
        </div>
      </div>
    </header>
  );
}
