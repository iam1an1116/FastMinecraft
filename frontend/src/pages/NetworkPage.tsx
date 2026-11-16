import { useState, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Copy, Check, Wifi, Globe2, Network, Radio } from 'lucide-react';
import { api } from '../lib/api';
import { ServerInfo } from '../components/Layout';

type NetworkMode = 'lan' | 'ipv6' | 'p2p';

export function NetworkPage() {
  const { id } = useParams<{ id: string }>();
  const context = useOutletContext<{ servers: ServerInfo[] }>();
  const [currentMode, setCurrentMode] = useState<NetworkMode>('lan');

  // Network states
  const [lanIp, setLanIp] = useState('127.0.0.1');
  const [ipv6, setIpv6] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // P2P states
  const [p2pActive, setP2pActive] = useState(false);
  const [roomCode, setRoomCode] = useState('');

  // Target server info
  const targetServer = context?.servers?.find(s => s.id === id) || context?.servers?.[0] || null;
  const port = targetServer?.port || 25565;

  useEffect(() => {
    api.getLanIp().then(d => { if (d.ip) setLanIp(d.ip); }).catch(() => {});
    api.getIpv6().then(d => { if (d.ip) setIpv6(d.ip); }).catch(() => {});
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleP2P = () => {
    if (!p2pActive) {
      const code = `FM-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      setRoomCode(code);
      setP2pActive(true);
    } else {
      setP2pActive(false);
      setRoomCode('');
    }
  };

  const lanAddress = `${lanIp}:${port}`;
  const ipv6Address = ipv6 ? `[${ipv6}]:${port}` : null;

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter">
      {/* Top Header & Segmented Pill Switch (Seamless, no divider) */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">联机中心</h1>
          {targetServer && (
            <span className="text-xs text-neutral-400 mt-1 block">
              当前目标: {targetServer.name} (:{port})
            </span>
          )}
        </div>

        {/* 3 Modes Switcher (Transparent default, soft gray active, no dividers) */}
        <div className="flex items-center bg-black/[0.04] p-0.5 rounded-full">
          <button
            onClick={() => setCurrentMode('lan')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              currentMode === 'lan'
                ? 'bg-black/[0.08] text-neutral-900 shadow-none'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>本地局域网</span>
          </button>

          <button
            onClick={() => setCurrentMode('ipv6')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              currentMode === 'ipv6'
                ? 'bg-black/[0.08] text-neutral-900 shadow-none'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Globe2 className="w-3.5 h-3.5" />
            <span>公网 IPv6</span>
          </button>

          <button
            onClick={() => setCurrentMode('p2p')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              currentMode === 'p2p'
                ? 'bg-black/[0.08] text-neutral-900 shadow-none'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>P2P 隧道</span>
          </button>
        </div>
      </div>

      {/* Main Content Panels */}
      {currentMode === 'lan' && (
        <div className="bg-white/70 backdrop-blur-md rounded-3xl p-10 shadow-soft flex flex-col items-center text-center space-y-6 border border-white/50">
          <div className="w-16 h-16 rounded-2xl bg-black/[0.04] flex items-center justify-center text-neutral-700">
            <Wifi className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-neutral-400">局域网连接地址</div>
            <div className="text-2xl font-mono font-bold tracking-tight text-neutral-900">
              {lanAddress}
            </div>
          </div>

          <button
            onClick={() => handleCopy(lanAddress)}
            className="btn-primary px-6 py-2.5 text-xs flex items-center gap-2"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? '已复制' : '复制地址'}</span>
          </button>
        </div>
      )}

      {currentMode === 'ipv6' && (
        <div className="bg-white/70 backdrop-blur-md rounded-3xl p-10 shadow-soft flex flex-col items-center text-center space-y-6 border border-white/50">
          <div className="w-16 h-16 rounded-2xl bg-black/[0.04] flex items-center justify-center text-neutral-700">
            <Globe2 className="w-8 h-8" />
          </div>

          {ipv6Address ? (
            <>
              <div className="space-y-1 max-w-lg">
                <div className="text-xs font-semibold text-neutral-400">公网 IPv6 直连地址</div>
                <div className="text-base font-mono font-bold tracking-tight text-neutral-900 break-all px-4">
                  {ipv6Address}
                </div>
              </div>

              <button
                onClick={() => handleCopy(ipv6Address)}
                className="btn-primary px-6 py-2.5 text-xs flex items-center gap-2"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? '已复制' : '复制地址'}</span>
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <span className="text-sm font-medium text-neutral-500">
                当前网络未检测到公网 IPv6 地址
              </span>
              <div>
                <button
                  onClick={() => setCurrentMode('p2p')}
                  className="btn-secondary text-xs px-4"
                >
                  切换至 P2P 隧道模式
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentMode === 'p2p' && (
        <div className="bg-white/70 backdrop-blur-md rounded-3xl p-10 shadow-soft flex flex-col items-center text-center space-y-6 border border-white/50">
          <div className="w-16 h-16 rounded-2xl bg-black/[0.04] flex items-center justify-center text-neutral-700">
            <Radio className={`w-8 h-8 ${p2pActive ? 'text-emerald-500 animate-pulse' : 'text-neutral-400'}`} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <span className={`status-dot ${p2pActive ? 'status-running' : 'status-stopped'}`} />
              <span className="text-sm font-semibold text-neutral-800">
                {p2pActive ? 'P2P 联机房间运行中' : 'P2P 联机房间已关闭'}
              </span>
            </div>

            {p2pActive && (
              <div className="pt-2">
                <div className="text-xs font-semibold text-neutral-400 mb-1">专属房间码</div>
                <div className="text-3xl font-mono font-black tracking-wider text-neutral-900 bg-black/[0.04] py-3 px-6 rounded-2xl inline-block">
                  {roomCode}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleP2P}
              className={p2pActive ? 'btn-danger px-6 py-2.5 text-xs' : 'btn-primary px-6 py-2.5 text-xs'}
            >
              {p2pActive ? '关闭房间' : '创建 P2P 联机房间'}
            </button>

            {p2pActive && (
              <button
                onClick={() => handleCopy(roomCode)}
                className="btn-secondary px-6 py-2.5 text-xs flex items-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '已复制' : '复制房间码'}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
