import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Archive, RotateCcw, Trash2, Plus } from 'lucide-react';
import { api } from '../lib/api';

interface Backup {
  id: string;
  type: string;
  file_path: string;
  file_size: number;
  created_at: string;
}

export function BackupManager() {
  const { id } = useParams<{ id: string }>();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (id) loadBackups(); }, [id]);

  async function loadBackups() {
    if (!id) return;
    try { const data = await api.getBackups(id); setBackups(data); } finally { setLoading(false); }
  }

  async function handleCreate(type: string) {
    if (!id) return;
    try { await api.createBackup(id, type); loadBackups(); } catch (err: any) { alert(err.message); }
  }

  async function handleRestore(backup: Backup) {
    if (!id || !confirm('确定恢复此备份？当前数据将被覆盖。')) return;
    try { await api.restoreBackup(id, backup.id); alert('备份恢复成功'); } catch (err: any) { alert(err.message); }
  }

  async function handleDelete(backup: Backup) {
    if (!id || !confirm('确定删除此备份？')) return;
    try { await api.deleteBackup(id, backup.id); loadBackups(); } catch (err: any) { alert(err.message); }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  return (
    <div className="flex-1 p-8 max-w-4xl w-full mx-auto page-enter">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">备份管理</h1>
          <span className="text-xs text-neutral-400 mt-1 block">已有 {backups.length} 个快照备份</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleCreate('world')} className="btn-secondary text-xs px-4 py-2">
            <Plus className="w-3.5 h-3.5" /> 世界备份
          </button>
          <button onClick={() => handleCreate('full')} className="btn-primary text-xs px-4 py-2">
            <Plus className="w-3.5 h-3.5" /> 全量备份
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-neutral-400 py-20">加载中...</div>
      ) : backups.length === 0 ? (
        <div className="text-center py-16 bg-white/70 backdrop-blur-md rounded-3xl p-10 shadow-soft border border-white/50">
          <div className="w-14 h-14 rounded-2xl bg-black/[0.04] flex items-center justify-center mx-auto mb-4 text-neutral-400">
            <Archive className="w-7 h-7" />
          </div>
          <span className="text-sm font-semibold text-neutral-700">暂无备份存档</span>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map(backup => (
            <div key={backup.id} className="bg-white/70 hover:bg-white/95 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between shadow-soft border border-white/50 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-neutral-100 rounded-2xl flex items-center justify-center text-neutral-800">
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-neutral-900 capitalize">
                    {backup.type === 'world' ? '世界数据快照' : '整服全量快照'}
                  </div>
                  <div className="text-xs text-neutral-400 font-mono mt-0.5">
                    {new Date(backup.created_at).toLocaleString()} • {formatSize(backup.file_size)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleRestore(backup)}
                  className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-neutral-600 hover:text-neutral-900"
                  title="恢复备份"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(backup)}
                  className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-neutral-400 hover:text-rose-500"
                  title="删除备份"
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
