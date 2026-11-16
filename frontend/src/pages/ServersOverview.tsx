import { useState, useEffect } from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { Play, Square, RotateCw, Loader2, Plus, Server, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { ServerInfo } from '../components/Layout';

export function ServersOverview() {
  const navigate = useNavigate();
  const context = useOutletContext<{ servers: ServerInfo[]; onServersRefresh: () => void }>();
  const [servers, setServers] = useState<ServerInfo[]>(context?.servers || []);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (context?.servers) {
      setServers(context.servers);
    }
  }, [context?.servers]);

  const refreshServers = async () => {
    try {
      const data = await api.getServers();
      setServers(data);
      context?.onServersRefresh?.();
    } catch {}
  };

  const statusConfig: Record<string, { label: string; dot: string; badge: string }> = {
    running: { label: '运行中', dot: 'bg-emerald-500', badge: 'badge-green' },
    stopped: { label: '已停止', dot: 'bg-neutral-400', badge: 'badge-gray' },
    starting: { label: '启动中', dot: 'bg-amber-500 animate-pulse', badge: 'badge-yellow' },
    downloading: { label: '下载中', dot: 'bg-sky-500 animate-pulse', badge: 'badge-blue' },
    crashed: { label: '已崩溃', dot: 'bg-rose-500', badge: 'badge-red' },
  };

  const handleStart = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.startServer(id);
      refreshServers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleStop = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.stopServer(id);
      refreshServers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleRestart = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.restartServer(id);
      refreshServers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">服务器列表</h1>
          <span className="text-xs text-neutral-400 mt-1 block">
            {servers.length} 个实例
          </span>
        </div>

        <Link
          to="/market"
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span>新建服务器</span>
        </Link>
      </div>

      {/* Server List */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 bg-white/70 backdrop-blur-md rounded-3xl shadow-soft text-center mt-6 border border-white/50">
          <div className="w-16 h-16 rounded-2xl bg-black/[0.04] flex items-center justify-center mb-5 text-neutral-500">
            <Server className="w-8 h-8" />
          </div>
          <p className="text-base font-semibold text-neutral-800 mb-6">暂无正在管理的服务器</p>
          <Link to="/market" className="btn-primary">
            <Plus className="w-4 h-4" />
            <span>前往市场部署新服务端</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map(s => {
            const st = statusConfig[s.status] || statusConfig.stopped;
            const isLoading = actionLoading[s.id];

            return (
              <div
                key={s.id}
                onClick={() => navigate(`/server/${s.id}`)}
                className="group bg-white/70 hover:bg-white/95 backdrop-blur-md rounded-2xl p-5 flex items-center justify-between cursor-pointer transition-all shadow-soft active:scale-[0.99] border border-white/50"
              >
                {/* Left Info */}
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-black/[0.04] flex items-center justify-center text-neutral-700 flex-shrink-0 group-hover:bg-black/[0.08] transition-colors">
                    <Server className="w-5 h-5" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-neutral-900 truncate text-base">
                        {s.name}
                      </span>
                      <span className={`badge ${st.badge}`}>
                        <span className={`status-dot ${st.dot}`} />
                        {st.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-neutral-400 mt-1 font-mono">
                      <span>{s.version}</span>
                      <span>•</span>
                      <span className="capitalize">{s.server_type}</span>
                      <span>•</span>
                      <span>端口 {s.port}</span>
                      <span>•</span>
                      <span>{s.max_memory}MB</span>
                    </div>
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  {s.status === 'running' ? (
                    <>
                      <button
                        onClick={e => handleStop(e, s.id)}
                        disabled={isLoading}
                        className="btn-danger text-xs px-4 py-2"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>停止</span>
                      </button>
                      <button
                        onClick={e => handleRestart(e, s.id)}
                        disabled={isLoading}
                        className="btn-secondary text-xs px-4 py-2"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>重启</span>
                      </button>
                    </>
                  ) : s.status === 'starting' ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-600 font-medium">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>启动中</span>
                    </div>
                  ) : (
                    <button
                      onClick={e => handleStart(e, s.id)}
                      disabled={isLoading}
                      className="btn-primary text-xs px-4 py-2"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>启动</span>
                    </button>
                  )}

                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-300 group-hover:text-neutral-700 transition-colors ml-2">
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
