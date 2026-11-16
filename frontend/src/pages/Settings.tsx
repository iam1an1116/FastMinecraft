import { useState, useEffect } from 'react';
import { Monitor, HardDrive, Check, X, FileText, RefreshCw, Loader2, Download, Search } from 'lucide-react';
import { api } from '../lib/api';

export function Settings() {
  const [javaPath, setJavaPath] = useState('');
  const [javaStatus, setJavaStatus] = useState<'unknown' | 'valid' | 'invalid'>('unknown');
  const [javaVersions, setJavaVersions] = useState<any[]>([]);
  const [javaDownloading, setJavaDownloading] = useState(false);
  const [javaDownloadProgress, setJavaDownloadProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [logContent, setLogContent] = useState<string | null>(null);

  useEffect(() => { loadJavaInfo(); }, []);

  async function loadJavaInfo() {
    try {
      const [runtimes, customPath] = await Promise.all([api.getJavaRuntimes(), api.getCustomJavaPath()]);
      setJavaVersions(runtimes);
      if (customPath.path) { setJavaPath(customPath.path); setJavaStatus('valid'); }
    } catch {}
  }

  async function testJavaPath() {
    if (!javaPath) return;
    try {
      const data = await api.testJavaPath(javaPath);
      setJavaStatus(data.valid ? 'valid' : 'invalid');
      if (data.valid) await api.setCustomJavaPath(javaPath);
    } catch { setJavaStatus('invalid'); }
  }

  async function handleScanJava() {
    setScanning(true);
    try {
      const result = await api.scanLocalJava();
      setJavaVersions(result.runtimes);
    } catch (err: any) {
      alert('扫描失败: ' + err.message);
    } finally {
      setScanning(false);
    }
  }

  async function handleDownloadJava(version: number) {
    setJavaDownloading(true); setJavaDownloadProgress(0);
    const progressInterval = setInterval(async () => {
      try {
        const progress = await api.getJavaDownloadProgress();
        setJavaDownloadProgress(progress.percent || 0);
      } catch {}
    }, 500);
    try {
      const result = await api.downloadJava(version);
      setJavaPath(result.path); setJavaStatus('valid');
      await loadJavaInfo();
    } catch (err: any) {
      alert(`下载失败: ${err.message}`);
    } finally {
      clearInterval(progressInterval);
      setJavaDownloading(false);
      setJavaDownloadProgress(0);
    }
  }

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-6">全局设置</h1>

      {/* Java Management */}
      <div className="bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-soft space-y-5 border border-white/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
              <Monitor className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-neutral-900">Java 环境</span>
          </div>

          <button
            onClick={handleScanJava}
            disabled={scanning}
            className="btn-secondary text-xs px-3.5 py-1.5"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>扫描本地 Java</span>
          </button>
        </div>

        {javaVersions.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {javaVersions.map((v, i) => (
              <div
                key={i}
                onClick={() => { setJavaPath(v.path); setJavaStatus('valid'); }}
                className="flex items-center justify-between p-3 rounded-2xl bg-neutral-50 hover:bg-neutral-100/80 cursor-pointer transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-mono font-bold text-neutral-900">Java {v.version}</span>
                  <div className="text-xs text-neutral-400 font-mono truncate mt-0.5">{v.path}</div>
                </div>
                <button className="text-xs font-medium text-neutral-700 bg-white shadow-soft px-3 py-1 rounded-full ml-3">
                  使用
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Manual Java Path Input */}
        <div className="space-y-2 pt-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={javaPath}
              onChange={e => { setJavaPath(e.target.value); setJavaStatus('unknown'); }}
              className="input flex-1 font-mono text-xs"
              placeholder="自定义 Java 路径，例如 /usr/bin/java"
            />
            <button onClick={testJavaPath} className="btn-secondary text-xs px-4">
              验证保存
            </button>
          </div>

          {javaStatus === 'valid' && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium px-2">
              <Check className="w-3.5 h-3.5" /> 路径有效
            </div>
          )}
          {javaStatus === 'invalid' && (
            <div className="flex items-center gap-1.5 text-xs text-rose-600 font-medium px-2">
              <X className="w-3.5 h-3.5" /> 路径无效
            </div>
          )}
        </div>

        {/* Auto Download Java */}
        <div className="pt-2">
          <div className="grid grid-cols-3 gap-2">
            {[
              { version: 21, label: 'Java 21 (1.21+)' },
              { version: 17, label: 'Java 17 (1.17-1.20)' },
              { version: 8, label: 'Java 8 (1.16-)' }
            ].map(item => (
              <button
                key={item.version}
                onClick={() => handleDownloadJava(item.version)}
                disabled={javaDownloading}
                className="flex items-center justify-between p-3 rounded-2xl bg-neutral-50 hover:bg-neutral-100 transition-colors text-left"
              >
                <span className="text-xs font-mono font-medium text-neutral-800">{item.label}</span>
                <Download className="w-3.5 h-3.5 text-neutral-400" />
              </button>
            ))}
          </div>

          {javaDownloading && (
            <div className="mt-3 bg-neutral-50 p-3 rounded-2xl">
              <div className="flex items-center justify-between text-xs text-neutral-600 mb-1.5">
                <span>正在下载 Adoptium Temurin...</span>
                <span className="font-mono font-medium">{javaDownloadProgress}%</span>
              </div>
              <div className="w-full bg-neutral-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-neutral-900 h-full rounded-full transition-all duration-300"
                  style={{ width: `${javaDownloadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Storage Path */}
      <div className="bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-soft space-y-3 border border-white/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
            <HardDrive className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm text-neutral-900">数据目录</span>
        </div>
        <div className="text-xs text-neutral-400 font-mono space-y-1">
          <div>实例: ./instances</div>
          <div>备份: ./backups</div>
          <div>运行时: ./java</div>
        </div>
      </div>

      {/* Backend Logs */}
      <div className="bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-soft space-y-4 border border-white/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
              <FileText className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-neutral-900">后端日志</span>
          </div>

          <button
            onClick={async () => {
              const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
              try {
                const r = await fetch(`${apiBase}/logs`);
                const d = await r.json();
                setLogContent(d.log || '(空)');
              } catch {
                setLogContent('(读取失败)');
              }
            }}
            className="btn-secondary text-xs px-3.5 py-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>刷新</span>
          </button>
        </div>

        {logContent !== null && (
          <div className="bg-neutral-950 text-neutral-300 font-mono text-xs p-4 rounded-2xl max-h-80 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
            {logContent || '(空)'}
          </div>
        )}
      </div>
    </div>
  );
}
