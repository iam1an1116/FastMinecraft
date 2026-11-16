import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Play, Square, RotateCw, Send, Users, Server,
  Copy, Download, Trash2, ChevronDown, Zap, Cpu, Activity, Settings, Loader2
} from 'lucide-react';
import { api } from '../lib/api';
import { wsClient } from '../lib/ws';

interface Stats {
  cpu: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  tps: number;
  mspt: number;
  players: number;
}

const QUICK_COMMANDS = [
  { cmd: 'list', label: '在线玩家' },
  { cmd: 'tps', label: 'TPS' },
  { cmd: 'gc', label: 'GC' },
  { cmd: 'save-all', label: '保存' },
  { cmd: 'whitelist list', label: '白名单' },
  { cmd: 'banlist', label: '封禁列表' },
  { cmd: 'time set day', label: '白天' },
  { cmd: 'time set night', label: '夜晚' },
  { cmd: 'weather clear', label: '晴天' },
  { cmd: 'difficulty normal', label: '普通' },
];

export function ServerConsole() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showQuickCmds, setShowQuickCmds] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showMemoryEdit, setShowMemoryEdit] = useState(false);
  const [editMemory, setEditMemory] = useState(2048);

  useEffect(() => {
    if (!id) return;
    loadServer();
    loadStats();
    setLogs([]);

    const logHandler = (_event: string, data: any) => {
      setLogs(prev => [...prev.slice(-2000), data.line]);
    };
    const statusHandler = (_event: string, data: any) => {
      setServer((prev: any) => prev ? { ...prev, status: data.status } : prev);
    };
    const statsHandler = (_event: string, data: Stats) => {
      setStats(data);
    };

    wsClient.subscribe(id, 'log', logHandler);
    wsClient.subscribe(id, 'status', statusHandler);
    wsClient.subscribe(id, 'stats', statsHandler);

    const statsInterval = setInterval(loadStats, 3000);

    return () => {
      wsClient.unsubscribe(id, 'log', logHandler);
      wsClient.unsubscribe(id, 'status', statusHandler);
      wsClient.unsubscribe(id, 'stats', statsHandler);
      clearInterval(statsInterval);
    };
  }, [id]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  async function loadServer() {
    if (!id) return;
    const data = await api.getServer(id);
    setServer(data);
    setEditMemory(data.max_memory);
  }

  async function loadStats() {
    if (!id) return;
    try {
      const data = await api.getStats(id);
      setStats(data);
    } catch {}
  }

  async function handleStart() {
    if (!id) return;
    try { await api.startServer(id); loadServer(); } catch (err: any) { alert(err.message); }
  }

  async function handleStop() {
    if (!id) return;
    try { await api.stopServer(id); loadServer(); } catch (err: any) { alert(err.message); }
  }

  async function handleRestart() {
    if (!id) return;
    try { await api.restartServer(id); loadServer(); } catch (err: any) { alert(err.message); }
  }

  async function handleForceStop() {
    if (!id) return;
    try { await api.forceStopServer(id); loadServer(); } catch (err: any) { alert(err.message); }
  }

  function sendCommand() {
    if (!command.trim() || !id) return;
    wsClient.sendCommand(id, command.trim());
    setCommandHistory(prev => [command.trim(), ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setCommand('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      sendCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand('');
      }
    }
  }

  function sendQuickCommand(cmd: string) {
    if (!id) return;
    wsClient.sendCommand(id, cmd);
    setShowQuickCmds(false);
  }

  function clearLogs() {
    setLogs([]);
  }

  function copyLogs() {
    navigator.clipboard.writeText(logs.join('\n'));
    alert('日志已复制到剪贴板');
  }

  function exportLogs() {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `server-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveMemory() {
    if (!id) return;
    try {
      await api.updateServerConfig(id, { max_memory: editMemory });
      setServer((prev: any) => prev ? { ...prev, max_memory: editMemory } : prev);
      setShowMemoryEdit(false);
      alert('内存设置已保存');
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    }
  }

  const filteredLogs = logFilter
    ? logs.filter(line => line.toLowerCase().includes(logFilter.toLowerCase()))
    : logs;

  if (!server) return <div className="p-8 text-neutral-400">加载中...</div>;

  const isRunning = server.status === 'running';
  const isStarting = server.status === 'starting';

  return (
    <div className="flex flex-col h-full p-6 page-enter">
      {/* Top Header Card */}
      <div className="bg-white/70 backdrop-blur-md rounded-3xl p-5 shadow-soft mb-4 flex-shrink-0 border border-white/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-tight text-neutral-900">{server.name}</span>
            <span className="text-xs font-mono text-neutral-400">
              {server.version} • {server.server_type} • :{server.port}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isRunning && !isStarting && (
              <button onClick={handleStart} className="btn-primary text-xs px-4 py-2">
                <Play className="w-3.5 h-3.5" /> 启动
              </button>
            )}
            {isStarting && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 启动中
                </span>
                <button onClick={handleForceStop} className="btn-danger text-xs px-4 py-2">
                  <Square className="w-3.5 h-3.5" /> 强制停止
                </button>
              </div>
            )}
            {isRunning && (
              <>
                <button onClick={handleStop} className="btn-danger text-xs px-4 py-2">
                  <Square className="w-3.5 h-3.5" /> 停止
                </button>
                <button onClick={handleRestart} className="btn-secondary text-xs px-4 py-2">
                  <RotateCw className="w-3.5 h-3.5" /> 重启
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats Row */}
        {stats && isRunning && (
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-neutral-100">
            <StatCard icon={<Cpu className="w-4 h-4" />} label="CPU" value={`${stats.cpu.toFixed(1)}%`}
              color={stats.cpu > 80 ? 'text-rose-600' : stats.cpu > 50 ? 'text-amber-600' : 'text-emerald-600'} />

            <div className="relative">
              <StatCard icon={<Activity className="w-4 h-4" />} label="内存" value={`${stats.memoryUsed}MB`}
                subValue={`/ ${stats.memoryTotal}MB`}
                color={stats.memoryPercent > 80 ? 'text-rose-600' : 'text-neutral-900'} />
              <button
                onClick={() => setShowMemoryEdit(!showMemoryEdit)}
                className="absolute -top-1 -right-1 p-1 bg-white rounded-full hover:bg-neutral-100 shadow-soft"
              >
                <Settings className="w-3 h-3 text-neutral-400" />
              </button>

              {/* Memory edit popup */}
              {showMemoryEdit && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-xl p-4 z-50 w-64 animate-fade-in">
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="number"
                      value={editMemory}
                      onChange={e => setEditMemory(Number(e.target.value))}
                      className="input flex-1 text-xs"
                      min={512} max={16384} step={512}
                    />
                    <span className="text-xs text-neutral-400">MB</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowMemoryEdit(false)} className="btn-secondary text-xs flex-1 py-1.5">取消</button>
                    <button onClick={saveMemory} className="btn-primary text-xs flex-1 py-1.5">保存</button>
                  </div>
                </div>
              )}
            </div>

            <StatCard icon={<Zap className="w-4 h-4" />} label="TPS" value={stats.tps.toFixed(1)}
              color={stats.tps >= 18 ? 'text-emerald-600' : stats.tps >= 15 ? 'text-amber-600' : 'text-rose-600'} />
            <StatCard icon={<Server className="w-4 h-4" />} label="MSPT" value={`${stats.mspt.toFixed(1)}ms`}
              color={stats.mspt < 40 ? 'text-emerald-600' : stats.mspt < 50 ? 'text-amber-600' : 'text-rose-600'} />
            <StatCard icon={<Users className="w-4 h-4" />} label="玩家" value={`${stats.players}`}
              color="text-neutral-900" />
          </div>
        )}
      </div>

      {/* Terminal Area */}
      <div className="flex-1 bg-white/70 backdrop-blur-md rounded-3xl shadow-soft p-4 flex flex-col min-h-0 border border-white/50">
        {/* Terminal Toolbar */}
        <div className="flex items-center justify-between pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowQuickCmds(!showQuickCmds)}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
              >
                快捷指令 <ChevronDown className="w-3 h-3" />
              </button>
              {showQuickCmds && (
                <div className="absolute top-full left-0 mt-1.5 w-48 bg-white rounded-2xl shadow-xl z-50 max-h-56 overflow-y-auto p-1.5 animate-fade-in">
                  {QUICK_COMMANDS.map((cmd, i) => (
                    <button
                      key={i}
                      onClick={() => sendQuickCommand(cmd.cmd)}
                      className="w-full text-left px-3 py-2 text-xs rounded-xl hover:bg-neutral-100 transition-colors flex items-center justify-between font-mono"
                    >
                      <span className="font-semibold text-neutral-800">{cmd.cmd}</span>
                      <span className="text-[10px] text-neutral-400 font-sans">{cmd.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input
              type="text"
              value={logFilter}
              onChange={e => setLogFilter(e.target.value)}
              placeholder="过滤日志..."
              className="input text-xs py-1.5 w-36"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer mr-2">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="rounded accent-neutral-900"
              />
              自动滚动
            </label>
            <button onClick={copyLogs} className="p-1.5 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-neutral-700" title="复制">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button onClick={exportLogs} className="p-1.5 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-neutral-700" title="导出">
              <Download className="w-3.5 h-3.5" />
            </button>
            <button onClick={clearLogs} className="p-1.5 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-neutral-700" title="清空">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Log Viewer Container */}
        <div ref={logRef} className="flex-1 overflow-y-auto p-4 bg-neutral-950 rounded-2xl font-mono text-xs text-neutral-300 min-h-0 leading-relaxed shadow-inner">
          {filteredLogs.length === 0 ? (
            <div className="text-neutral-600 text-center py-12">
              {isRunning ? '等待控制台输出...' : '服务器已停止'}
            </div>
          ) : (
            filteredLogs.map((line, i) => (
              <div key={i} className={`py-0.5 ${line.includes('ERROR') || line.includes('Exception') ? 'text-rose-400' : 'text-neutral-300'}`}>
                {line}
              </div>
            ))
          )}
        </div>

        {/* Command Input Bar */}
        <div className="flex items-center gap-2 pt-3 flex-shrink-0">
          <input
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? '输入指令，按 Enter 执行...' : '服务器未运行'}
            disabled={!isRunning}
            className="input flex-1 font-mono text-xs py-2.5"
          />
          <button
            onClick={sendCommand}
            disabled={!isRunning || !command.trim()}
            className="btn-primary text-xs px-4 py-2.5"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, subValue, color }: {
  icon: React.ReactNode; label: string; value: string; subValue?: string; color: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 rounded-2xl">
      <div className="text-neutral-400">{icon}</div>
      <div>
        <div className="text-[10px] text-neutral-400 font-semibold">{label}</div>
        <div className={`text-xs font-bold ${color}`}>
          {value}{subValue && <span className="text-neutral-400 font-normal text-[10px] ml-0.5">{subValue}</span>}
        </div>
      </div>
    </div>
  );
}
