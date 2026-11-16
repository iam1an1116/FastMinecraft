import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Upload, Check, Loader2, Sparkles, FolderUp } from 'lucide-react';
import { api } from '../lib/api';

const SERVER_TYPES = [
  { id: 'paper', name: 'Paper', desc: '高性能插件服' },
  { id: 'purpur', name: 'Purpur', desc: '极致定制插件服' },
  { id: 'fabric', name: 'Fabric', desc: '轻量模组服' },
  { id: 'forge', name: 'Forge', desc: '经典大型模组服' },
  { id: 'neoforge', name: 'NeoForge', desc: '现代模组核心' },
  { id: 'vanilla', name: 'Vanilla', desc: '原版纯净核心' },
];

export function MarketPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'download' | 'upload'>('download');

  // Form states
  const [serverType, setServerType] = useState('paper');
  const [version, setVersion] = useState('1.21.4');
  const [versions, setVersions] = useState<{ version: string }[]>([]);
  const [name, setName] = useState('');
  const [maxMemory, setMaxMemory] = useState(4096);
  const [loading, setLoading] = useState(false);
  const [fetchingVersions, setFetchingVersions] = useState(false);

  // Upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'download') {
      loadVersions(serverType);
    }
  }, [serverType, activeTab]);

  const loadVersions = async (type: string) => {
    setFetchingVersions(true);
    try {
      const data = await api.getVersions(type);
      setVersions(data.slice(0, 25));
      if (data.length > 0) {
        setVersion(data[0].version);
      }
    } catch {}
    finally {
      setFetchingVersions(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.jar') && !file.name.endsWith('.zip')) {
        alert('请选择 .jar 或 .zip 格式的服务端文件');
        return;
      }
      setSelectedFile(file);
      if (!name) {
        setName(file.name.replace(/\.(jar|zip)$/i, ''));
      }
    }
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || `${serverType}-${version}`;

    setLoading(true);
    try {
      if (activeTab === 'upload') {
        if (!selectedFile) {
          alert('请选择要上传的服务端文件');
          return;
        }
        const formData = new FormData();
        formData.append('serverJar', selectedFile);
        formData.append('name', finalName);
        formData.append('maxMemory', String(maxMemory));

        const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3001/api' : '/api';
        const response = await fetch(`${apiBase}/servers/upload`, {
          method: 'POST',
          headers: { 'x-fm-token': 'fm-local-token' },
          body: formData
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || '上传部署失败');
        }
      } else {
        await api.createServer({
          name: finalName,
          version,
          serverType,
          maxMemory,
        });
      }

      navigate('/');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter">
      {/* Top Header & Tab Switch */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">服务端市场</h1>

        <div className="flex items-center bg-black/[0.04] p-0.5 rounded-full">
          <button
            onClick={() => setActiveTab('download')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'download'
                ? 'bg-black/[0.08] text-neutral-900 shadow-none'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>官方核心</span>
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'upload'
                ? 'bg-black/[0.08] text-neutral-900 shadow-none'
                : 'bg-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>自定义上传</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleDeploy} className="space-y-6">
        {activeTab === 'download' ? (
          <>
            {/* Core Type Grid */}
            <div className="grid grid-cols-3 gap-3">
              {SERVER_TYPES.map(t => {
                const selected = serverType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setServerType(t.id)}
                    className={`p-4 rounded-2xl text-left transition-all ${
                      selected
                        ? 'bg-black/[0.09] text-neutral-900 shadow-none'
                        : 'bg-white/70 backdrop-blur-md text-neutral-700 hover:bg-white/90 shadow-soft border border-white/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm tracking-wide">{t.name}</span>
                      {selected && <Check className="w-4 h-4 text-neutral-800" />}
                    </div>
                    <span className="text-xs block text-neutral-400">
                      {t.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Version Selector */}
            <div className="bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-soft space-y-4 border border-white/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-neutral-800">核心版本</span>
                {fetchingVersions && (
                  <span className="text-xs text-neutral-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> 加载中
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1">
                {versions.map(v => (
                  <button
                    key={v.version}
                    type="button"
                    onClick={() => setVersion(v.version)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all ${
                      version === v.version
                        ? 'bg-black/[0.09] text-neutral-900 font-bold'
                        : 'bg-black/[0.03] text-neutral-600 hover:bg-black/[0.06]'
                    }`}
                  >
                    {v.version}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* Upload Custom Jar */
          <div className="bg-white/70 backdrop-blur-md rounded-3xl p-8 shadow-soft flex flex-col items-center text-center border border-white/50">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jar,.zip"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-12 rounded-2xl bg-black/[0.02] hover:bg-black/[0.05] cursor-pointer transition-all flex flex-col items-center justify-center group"
            >
              <div className="w-14 h-14 rounded-2xl bg-white shadow-soft flex items-center justify-center mb-4 text-neutral-700 group-hover:scale-105 transition-transform">
                <FolderUp className="w-7 h-7" />
              </div>

              {selectedFile ? (
                <div className="font-semibold text-sm text-neutral-900">
                  {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                </div>
              ) : (
                <span className="text-sm font-medium text-neutral-700">
                  点击选择本地服务端 (.jar / .zip)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Server Config & Memory */}
        <div className="bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-soft space-y-4 border border-white/50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-2">服务器名称</label>
              <input
                type="text"
                placeholder={activeTab === 'download' ? `${serverType}-${version}` : '我的服务器'}
                value={name}
                onChange={e => setName(e.target.value)}
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-2">最大内存 (MB)</label>
              <div className="flex gap-2">
                {[2048, 4096, 8192].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMaxMemory(m)}
                    className={`flex-1 py-2.5 rounded-2xl text-xs font-medium transition-all ${
                      maxMemory === m
                        ? 'bg-black/[0.09] text-neutral-900 font-bold'
                        : 'bg-black/[0.03] text-neutral-600 hover:bg-black/[0.06]'
                    }`}
                  >
                    {m / 1024}G
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-8 py-3 text-sm flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>一键部署并开服</span>
          </button>
        </div>
      </form>
    </div>
  );
}
