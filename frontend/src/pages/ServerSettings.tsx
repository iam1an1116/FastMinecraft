import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Save, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';

interface SettingItem {
  key: string;
  label: string;
  type: 'toggle' | 'select' | 'number' | 'text';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  group: string;
}

const SETTINGS: SettingItem[] = [
  // 基础设置
  { key: 'motd', label: '服务器描述', type: 'text', group: '基础设置' },
  { key: 'max-players', label: '最大玩家数', type: 'number', min: 1, max: 1000, group: '基础设置' },
  { key: 'online-mode', label: '正版验证', type: 'toggle', group: '基础设置' },
  { key: 'white-list', label: '白名单', type: 'toggle', group: '基础设置' },
  { key: 'enforce-whitelist', label: '强制白名单', type: 'toggle', group: '基础设置' },
  { key: 'pvp', label: 'PVP 伤害', type: 'toggle', group: '基础设置' },

  // 世界设置
  { key: 'level-name', label: '世界名称', type: 'text', group: '世界设置' },
  { key: 'level-seed', label: '世界种子', type: 'text', group: '世界设置' },
  { key: 'level-type', label: '世界类型', type: 'select', options: [
    { value: 'minecraft\\:normal', label: '默认' },
    { value: 'minecraft\\:flat', label: '超平坦' },
    { value: 'minecraft\\:large_biomes', label: '大型生物群系' },
    { value: 'minecraft\\:amplified', label: '放大化' },
  ], group: '世界设置' },
  { key: 'gamemode', label: '游戏模式', type: 'select', options: [
    { value: 'survival', label: '生存' },
    { value: 'creative', label: '创造' },
    { value: 'adventure', label: '冒险' },
    { value: 'spectator', label: '旁观' },
  ], group: '世界设置' },
  { key: 'difficulty', label: '难度', type: 'select', options: [
    { value: 'peaceful', label: '和平' },
    { value: 'easy', label: '简单' },
    { value: 'normal', label: '普通' },
    { value: 'hard', label: '困难' },
  ], group: '世界设置' },
  { key: 'hardcore', label: '极限模式', type: 'toggle', group: '世界设置' },
  { key: 'allow-nether', label: '允许下界', type: 'toggle', group: '世界设置' },
  { key: 'spawn-protection', label: '出生点保护半径', type: 'number', min: 0, max: 10000, group: '世界设置' },
  { key: 'generate-structures', label: '生成结构', type: 'toggle', group: '世界设置' },

  // 性能设置
  { key: 'view-distance', label: '视距 (区块)', type: 'select', options: [
    { value: '4', label: '4 (低)' },
    { value: '8', label: '8 (中)' },
    { value: '10', label: '10 (推荐)' },
    { value: '12', label: '12 (高)' },
    { value: '16', label: '16 (极高)' },
  ], group: '性能设置' },
  { key: 'simulation-distance', label: '模拟距离', type: 'select', options: [
    { value: '4', label: '4' },
    { value: '8', label: '8' },
    { value: '12', label: '12' },
  ], group: '性能设置' },
  { key: 'max-tick-time', label: '最大 Tick 耗时 (ms)', type: 'number', min: -1, max: 600000, group: '性能设置' },
  { key: 'network-compression-threshold', label: '数据包压缩阈值', type: 'number', min: -1, max: 65535, group: '性能设置' },

  // 功能设置
  { key: 'enable-command-block', label: '命令方块', type: 'toggle', group: '功能设置' },
  { key: 'allow-flight', label: '允许飞行', type: 'toggle', group: '功能设置' },
  { key: 'spawn-npcs', label: '生成 NPC 村民', type: 'toggle', group: '功能设置' },
  { key: 'spawn-animals', label: '生成动物', type: 'toggle', group: '功能设置' },
  { key: 'spawn-monsters', label: '生成怪物', type: 'toggle', group: '功能设置' },
  { key: 'server-port', label: '服务监听端口', type: 'number', min: 1, max: 65535, group: '功能设置' },
];

export function ServerSettings() {
  const { id } = useParams<{ id: string }>();
  const [props, setProps] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => { if (id) loadProperties(); }, [id]);

  async function loadProperties() {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.getServerProperties(id);
      setProps(data);
    } catch (err: any) {
      alert('加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateProp(key: string, value: string) {
    setProps(prev => ({ ...prev, [key]: value }));
    setChanged(true);
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateServerProperties(id, props);
      setChanged(false);
      alert('保存成功');
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    loadProperties();
    setChanged(false);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  const groups = SETTINGS.reduce<Record<string, SettingItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="flex-1 p-8 max-w-5xl w-full mx-auto page-enter space-y-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">服务器配置</h1>
        <div className="flex items-center gap-2">
          {changed && (
            <button onClick={handleReset} className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> 重置
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!changed || saving}
            className="btn-primary text-xs px-5 py-2 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>保存配置</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-soft space-y-4 border border-white/50">
            <h2 className="text-sm font-bold text-neutral-900 border-b border-neutral-100 pb-3">{group}</h2>
            <div className="space-y-3">
              {items.map(item => (
                <SettingRow
                  key={item.key}
                  item={item}
                  value={props[item.key] ?? ''}
                  onChange={(v) => updateProp(item.key, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingRow({ item, value, onChange }: { item: SettingItem; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="text-xs font-semibold text-neutral-700 flex-1">{item.label}</div>
      <div className="flex-shrink-0 w-32">
        {item.type === 'toggle' && (
          <button
            onClick={() => onChange(value === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              value === 'true' ? 'bg-neutral-900' : 'bg-neutral-200'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
              value === 'true' ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        )}
        {item.type === 'select' && (
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="input w-full text-xs py-1.5"
          >
            <option value="">默认</option>
            {item.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
        {item.type === 'number' && (
          <input
            type="number"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="input w-full text-xs font-mono py-1.5"
            min={item.min}
            max={item.max}
          />
        )}
        {item.type === 'text' && (
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="input w-full text-xs py-1.5"
          />
        )}
      </div>
    </div>
  );
}
