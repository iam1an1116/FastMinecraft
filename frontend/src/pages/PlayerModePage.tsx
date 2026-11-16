import { useState } from 'react';
import { Gamepad2, Loader2, Copy, Check } from 'lucide-react';

export function PlayerModePage() {
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [copied, setCopied] = useState(false);
  const [ping, setPing] = useState<number | null>(null);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;

    setStatus('connecting');
    // Simulate initial P2P handshake
    setTimeout(() => {
      setStatus('connected');
      setPing(Math.floor(Math.random() * 15) + 12);
    }, 1200);
  };

  const handleDisconnect = () => {
    setStatus('idle');
    setPing(null);
  };

  const copyLocalAddress = () => {
    navigator.clipboard.writeText('127.0.0.1:25565');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-xl mx-auto w-full page-enter">
      <div className="w-full bg-white/70 backdrop-blur-2xl rounded-3xl p-10 shadow-soft flex flex-col items-center text-center border border-white/50">
        {/* Top Icon */}
        <div className="w-16 h-16 rounded-2xl bg-black/[0.04] flex items-center justify-center mb-6 text-neutral-800">
          <Gamepad2 className="w-8 h-8" />
        </div>

        <div className="text-xl font-bold tracking-tight text-neutral-900 mb-6">
          加入联机
        </div>

        {status === 'idle' && (
          <form onSubmit={handleConnect} className="w-full space-y-4">
            <input
              type="text"
              placeholder="输入 6 位房间码 (例如 FM-9527)"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              className="input w-full text-center font-mono text-lg tracking-wider font-semibold py-3.5"
              maxLength={8}
            />

            <button
              type="submit"
              disabled={!roomCode.trim()}
              className="btn-primary w-full py-3.5 text-sm font-semibold"
            >
              一键加入
            </button>
          </form>
        )}

        {status === 'connecting' && (
          <div className="py-8 flex flex-col items-center space-y-4">
            <Loader2 className="w-8 h-8 text-neutral-700 animate-spin" />
            <span className="text-sm font-medium text-neutral-600 font-mono">
              正在穿透打洞连接 {roomCode}...
            </span>
          </div>
        )}

        {status === 'connected' && (
          <div className="w-full space-y-6 animate-fade-in">
            <div className="p-5 rounded-2xl bg-emerald-50 text-emerald-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-bold">联机已就绪</span>
              </div>
              {ping && (
                <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-white text-emerald-700 shadow-soft">
                  {ping} ms
                </span>
              )}
            </div>

            <div className="bg-black/[0.03] p-5 rounded-2xl space-y-2">
              <span className="text-xs font-semibold text-neutral-400 block">在 Minecraft 多人游戏中连接</span>
              <div className="text-2xl font-mono font-bold text-neutral-900">
                127.0.0.1:25565
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={copyLocalAddress}
                className="btn-primary flex-1 py-3 text-xs flex items-center justify-center gap-2"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? '已复制' : '复制游戏连接地址'}</span>
              </button>

              <button
                onClick={handleDisconnect}
                className="btn-danger py-3 px-5 text-xs"
              >
                断开
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
