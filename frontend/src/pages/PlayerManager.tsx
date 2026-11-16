import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Users, UserMinus, Ban, Crown, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

interface Player {
  name: string;
  ip: string;
  ping: number;
  joinTime: string;
}

export function PlayerManager() {
  const { id } = useParams<{ id: string }>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverStatus, setServerStatus] = useState('');

  useEffect(() => {
    if (id) { loadPlayers(); loadServer(); }
    const interval = setInterval(() => { if (id) loadPlayers(); }, 3000);
    return () => clearInterval(interval);
  }, [id]);

  async function loadServer() {
    if (!id) return;
    try { const data = await api.getServer(id); setServerStatus(data.status); } catch {}
  }

  async function loadPlayers() {
    if (!id) return;
    try { const data = await api.getPlayers(id); setPlayers(data); } finally { setLoading(false); }
  }

  async function handleKick(player: Player) {
    if (!id) return;
    const reason = prompt('踢出原因（可选）');
    try { await api.kickPlayer(id, player.name, reason || undefined); setTimeout(loadPlayers, 1000); } catch (err: any) { alert(err.message); }
  }

  async function handleBan(player: Player) {
    if (!id || !confirm(`确定封禁玩家 ${player.name}？`)) return;
    const reason = prompt('封禁原因（可选）');
    try { await api.banPlayer(id, player.name, reason || undefined); setTimeout(loadPlayers, 1000); } catch (err: any) { alert(err.message); }
  }

  async function handleOp(player: Player) {
    if (!id) return;
    try { await api.opPlayer(id, player.name); alert(`已将 ${player.name} 设为 OP`); } catch (err: any) { alert(err.message); }
  }

  function formatJoinTime(time: string) {
    try { return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return time; }
  }

  if (serverStatus !== 'running') {
    return (
      <div className="flex-1 flex items-center justify-center p-8 animate-fade-in">
        <div className="text-center bg-white rounded-3xl p-12 shadow-soft max-w-sm w-full">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 flex items-center justify-center mx-auto mb-4 text-neutral-400">
            <Users className="w-7 h-7" />
          </div>
          <span className="text-base font-bold text-neutral-800">服务器未运行</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">玩家管理</h1>
          <span className="text-xs text-neutral-400 mt-1 block">在线玩家: {players.length}</span>
        </div>
        <button onClick={loadPlayers} className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="text-center text-neutral-400 py-20">加载中...</div>
      ) : players.length === 0 ? (
        <div className="text-center py-16 bg-white/70 backdrop-blur-md rounded-3xl p-10 shadow-soft border border-white/50">
          <div className="w-14 h-14 rounded-2xl bg-black/[0.04] flex items-center justify-center mx-auto mb-4 text-neutral-400">
            <Users className="w-7 h-7" />
          </div>
          <span className="text-sm font-semibold text-neutral-700">暂无在线玩家</span>
        </div>
      ) : (
        <div className="space-y-3">
          {players.map(player => (
            <div key={player.name} className="bg-white/70 hover:bg-white/95 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between shadow-soft border border-white/50 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-neutral-100 rounded-2xl flex items-center justify-center font-bold text-sm text-neutral-800">
                  {player.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-bold text-neutral-900">{player.name}</div>
                  <div className="text-xs text-neutral-400 flex items-center gap-2 mt-0.5 font-mono">
                    {player.ip && <span>{player.ip}</span>}
                    {player.ping > 0 && <span>• {player.ping}ms</span>}
                    {player.joinTime && <span>• {formatJoinTime(player.joinTime)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleOp(player)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-amber-500" title="设为 OP">
                  <Crown className="w-4 h-4" />
                </button>
                <button onClick={() => handleKick(player)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-orange-500" title="踢出">
                  <UserMinus className="w-4 h-4" />
                </button>
                <button onClick={() => handleBan(player)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-rose-500" title="封禁">
                  <Ban className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
