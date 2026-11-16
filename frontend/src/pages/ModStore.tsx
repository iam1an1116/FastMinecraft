import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Upload, Trash2, Power, Box } from 'lucide-react';
import { api } from '../lib/api';

interface Mod {
  id: string;
  name: string;
  file_name: string;
  version: string;
  loader: string;
  enabled: boolean;
}

export function ModStore() {
  const { id } = useParams<{ id: string }>();
  const [mods, setMods] = useState<Mod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (id) loadMods(); }, [id]);

  async function loadMods() {
    if (!id) return;
    try { const data = await api.getMods(id); setMods(data); } finally { setLoading(false); }
  }

  async function handleUpload() {
    if (!id) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.jar';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('loader', 'fabric');
      try { await api.uploadMod(id, formData); loadMods(); } catch (err: any) { alert(err.message); }
    };
    input.click();
  }

  async function handleToggle(mod: Mod) {
    if (!id) return;
    try { await api.toggleMod(id, mod.id, !mod.enabled); loadMods(); } catch (err: any) { alert(err.message); }
  }

  async function handleDelete(mod: Mod) {
    if (!id || !confirm(`确定删除 Mod ${mod.name}？`)) return;
    try { await api.deleteMod(id, mod.id); loadMods(); } catch (err: any) { alert(err.message); }
  }

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Mod 管理</h1>
          <span className="text-xs text-neutral-400 mt-1 block">已安装 {mods.length} 个 Mod</span>
        </div>
        <button onClick={handleUpload} className="btn-primary text-xs flex items-center gap-2">
          <Upload className="w-3.5 h-3.5" /> 上传 Mod
        </button>
      </div>

      {loading ? (
        <div className="text-center text-neutral-400 py-20">加载中...</div>
      ) : mods.length === 0 ? (
        <div className="text-center py-16 bg-white/70 backdrop-blur-md rounded-3xl p-10 shadow-soft border border-white/50">
          <div className="w-14 h-14 rounded-2xl bg-black/[0.04] flex items-center justify-center mx-auto mb-4 text-neutral-400">
            <Box className="w-7 h-7" />
          </div>
          <span className="text-sm font-semibold text-neutral-700">暂无已安装的 Mod</span>
        </div>
      ) : (
        <div className="space-y-3">
          {mods.map(mod => (
            <div
              key={mod.id}
              className={`bg-white/70 hover:bg-white/95 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between transition-all shadow-soft border border-white/50 ${
                !mod.enabled ? 'opacity-60 bg-white/40' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  mod.enabled ? 'bg-black/[0.06] text-neutral-800' : 'bg-black/[0.03] text-neutral-400'
                }`}>
                  <Box className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className={`text-sm font-bold truncate ${!mod.enabled ? 'text-neutral-500' : 'text-neutral-900'}`}>
                    {mod.name}
                  </div>
                  <div className="text-xs text-neutral-400 font-mono truncate mt-0.5">{mod.file_name}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="badge badge-gray font-mono">{mod.loader}</span>
                <span className={`badge ${mod.enabled ? 'badge-green' : 'badge-red'}`}>
                  {mod.enabled ? '已启用' : '已禁用'}
                </span>
                <button
                  onClick={() => handleToggle(mod)}
                  className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
                  title={mod.enabled ? '禁用' : '启用'}
                >
                  <Power className={`w-4 h-4 ${mod.enabled ? 'text-emerald-500' : 'text-rose-400'}`} />
                </button>
                <button
                  onClick={() => handleDelete(mod)}
                  className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-rose-500"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
