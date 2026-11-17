import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/window_service.dart';
import '../widgets/memory_slider.dart';
import '../widgets/ripple_button.dart';
import '../widgets/sliding_pill_bar.dart';

class MarketItem {
  final String id;
  final String title;
  final String subtitle;
  final String badgeVersion;
  final String category; // 'core' | 'modpack'
  final String? iconUrl;
  final Color iconBg;
  final IconData fallbackIcon;
  final int? downloads;

  const MarketItem({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.badgeVersion,
    required this.category,
    this.iconUrl,
    required this.iconBg,
    required this.fallbackIcon,
    this.downloads,
  });
}

class MarketPage extends StatefulWidget {
  final VoidCallback onDeployed;

  const MarketPage({super.key, required this.onDeployed});

  @override
  State<MarketPage> createState() => _MarketPageState();
}

class _MarketPageState extends State<MarketPage> {
  static const List<MarketItem> _coreItems = [
    MarketItem(
      id: 'paper',
      title: 'Paper',
      subtitle: '高性能插件服务端核心，兼容 Spigot/Bukkit 插件生态',
      badgeVersion: '1.21+',
      category: 'core',
      iconBg: Color(0xFFE0F2FE),
      fallbackIcon: CupertinoIcons.bolt_fill,
    ),
    MarketItem(
      id: 'purpur',
      title: 'Purpur',
      subtitle: '基于 Paper 深度扩展，提供丰富游戏性调优选项',
      badgeVersion: '1.21+',
      category: 'core',
      iconBg: Color(0xFFF3E8FF),
      fallbackIcon: CupertinoIcons.sparkles,
    ),
    MarketItem(
      id: 'fabric',
      title: 'Fabric',
      subtitle: '轻量级现代模组加载器，启动快、新版本更新迅速',
      badgeVersion: '1.21+',
      category: 'core',
      iconBg: Color(0xFFFEF3C7),
      fallbackIcon: CupertinoIcons.layers_alt_fill,
    ),
    MarketItem(
      id: 'neoforge',
      title: 'NeoForge',
      subtitle: '新一代大型模组平台，适用于高版本现代模组包',
      badgeVersion: '1.21+',
      category: 'core',
      iconBg: Color(0xFFFFEDD5),
      fallbackIcon: CupertinoIcons.hammer_fill,
    ),
    MarketItem(
      id: 'forge',
      title: 'Forge',
      subtitle: '经典大型模组服务端，适配海量传统模组与整合包',
      badgeVersion: '1.20.4',
      category: 'core',
      iconBg: Color(0xFFE2E8F0),
      fallbackIcon: CupertinoIcons.wrench_fill,
    ),
    MarketItem(
      id: 'vanilla',
      title: 'Vanilla',
      subtitle: 'Mojang 官方原版纯净服务端，零修改原汁原味',
      badgeVersion: '1.21+',
      category: 'core',
      iconBg: Color(0xFFDCFCE7),
      fallbackIcon: CupertinoIcons.cube_fill,
    ),
  ];

  int _filterIndex = 0; // 0: 全部, 1: 服务端, 2: 整合包, 3: 上传
  final TextEditingController _searchCtrl = TextEditingController();
  Timer? _searchDebounce;

  List<MarketItem> _modpacks = [];
  bool _loadingModpacks = true;

  // Expanded inline deployment state
  String? _expandedItemId;
  List<String> _versions = [];
  List<Map<String, dynamic>> _modpackVersions = [];
  bool _loadingVersions = false;
  String _selectedVersion = '';
  String? _selectedModpackVersionId;
  final TextEditingController _nameCtrl = TextEditingController();
  int _selectedMemory = 4096;
  String _gamemode = 'survival';
  bool _onlineMode = true;
  bool _deploying = false;
  String? _errorText;

  // Upload tab state
  String? _uploadFilePath;
  final TextEditingController _uploadNameCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetchModpacks('');
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchCtrl.dispose();
    _nameCtrl.dispose();
    _uploadNameCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchModpacks(String query) async {
    setState(() => _loadingModpacks = true);
    final list = await ApiService.searchModpacks(query: query);
    if (!mounted) return;
    setState(() {
      _modpacks = list.map((m) {
        return MarketItem(
          id: 'mp:${m['id']}',
          title: m['title']?.toString() ?? 'Modpack',
          subtitle: m['description']?.toString() ?? '',
          badgeVersion: m['latestVersion']?.toString() ?? '',
          category: 'modpack',
          iconUrl: m['iconUrl']?.toString(),
          iconBg: const Color(0xFFF1F5F9),
          fallbackIcon: CupertinoIcons.cube_box_fill,
          downloads: m['downloads'] is int ? m['downloads'] : null,
        );
      }).toList();
      _loadingModpacks = false;
    });
  }

  void _onSearchChanged(String val) {
    setState(() {});
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 420), () {
      if (mounted) _fetchModpacks(val.trim());
    });
  }

  Future<void> _toggleExpand(MarketItem item) async {
    if (_expandedItemId == item.id) {
      setState(() {
        _expandedItemId = null;
        _errorText = null;
      });
      return;
    }

    setState(() {
      _expandedItemId = item.id;
      _errorText = null;
      _loadingVersions = true;
      _versions = [];
      _modpackVersions = [];
      _selectedVersion = '';
      _selectedModpackVersionId = null;
      _nameCtrl.text = item.title.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_-]'), '-');
      _selectedMemory = item.category == 'modpack' ? 4096 : 2048;
    });

    if (item.category == 'core') {
      final list = await ApiService.getVersions(item.id);
      if (mounted && _expandedItemId == item.id) {
        setState(() {
          _versions = list.take(16).toList();
          if (_versions.isNotEmpty) {
            _selectedVersion = _versions.first;
            _nameCtrl.text = '${item.id}-$_selectedVersion';
          }
          _loadingVersions = false;
        });
      }
    } else {
      final projectId = item.id.replaceFirst('mp:', '');
      final list = await ApiService.getModpackVersions(projectId);
      if (mounted && _expandedItemId == item.id) {
        setState(() {
          _modpackVersions = list;
          if (list.isNotEmpty) {
            _selectedModpackVersionId = list.first['id']?.toString();
            final gvs = list.first['gameVersions'] as List?;
            _selectedVersion = (gvs != null && gvs.isNotEmpty) ? gvs.first.toString() : item.badgeVersion;
          }
          _loadingVersions = false;
        });
      }
    }
  }

  Future<void> _deployItem(MarketItem item) async {
    final name = _nameCtrl.text.trim().isEmpty ? item.title : _nameCtrl.text.trim();
    setState(() {
      _deploying = true;
      _errorText = null;
    });
    bool ok = false;

    if (item.category == 'core') {
      ok = await ApiService.createServer(
        name: name,
        version: _selectedVersion.isEmpty ? '1.21.4' : _selectedVersion,
        serverType: item.id,
        maxMemory: _selectedMemory,
        gamemode: _gamemode,
        onlineMode: _onlineMode,
      );
    } else {
      final projectId = item.id.replaceFirst('mp:', '');
      ok = await ApiService.deployModpack(
        projectId: projectId,
        versionId: _selectedModpackVersionId,
        name: name,
        gameVersion: _selectedVersion,
        maxMemory: _selectedMemory,
        gamemode: _gamemode,
        onlineMode: _onlineMode,
      );
    }

    if (mounted) {
      setState(() {
        _deploying = false;
        if (!ok) {
          _errorText = ApiService.lastError ?? '部署失败，请检查名称或网络后重试';
        }
      });
      if (ok) widget.onDeployed();
    }
  }

  List<MarketItem> get _filteredItems {
    final q = _searchCtrl.text.trim().toLowerCase();
    final List<MarketItem> combined = [];
    if (_filterIndex == 0 || _filterIndex == 1) {
      combined.addAll(_coreItems.where((c) =>
          q.isEmpty || c.title.toLowerCase().contains(q) || c.subtitle.toLowerCase().contains(q)));
    }
    if (_filterIndex == 0 || _filterIndex == 2) {
      combined.addAll(_modpacks);
    }
    return combined;
  }

  String _formatDownloads(int? n) {
    if (n == null) return '';
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(0)}K';
    return '$n';
  }

  @override
  Widget build(BuildContext context) {
    final items = _filteredItems;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 860),
          padding: const EdgeInsets.symmetric(horizontal: 34, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Large Search Bar
              Container(
                height: 46,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.04),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    Icon(CupertinoIcons.search, size: 17, color: Colors.black.withOpacity(0.4)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _searchCtrl,
                        onChanged: _onSearchChanged,
                        style: const TextStyle(fontSize: 14, color: Color(0xFF151515)),
                        decoration: InputDecoration(
                          border: InputBorder.none,
                          hintText: '搜索服务端核心或 Modrinth 热门整合包...',
                          hintStyle: TextStyle(fontSize: 13, color: Colors.black.withOpacity(0.35)),
                          isDense: true,
                        ),
                      ),
                    ),
                    if (_searchCtrl.text.isNotEmpty)
                      RippleButton(
                        padding: const EdgeInsets.all(4),
                        onTap: () {
                          _searchCtrl.clear();
                          _onSearchChanged('');
                        },
                        child: Icon(CupertinoIcons.xmark_circle_fill, size: 15, color: Colors.black.withOpacity(0.3)),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),

              // Filter Tabs with Smooth Sliding Pill
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  SlidingPillBar(
                    selectedIndex: _filterIndex,
                    onChanged: (idx) => setState(() {
                      _filterIndex = idx;
                      _expandedItemId = null;
                      _errorText = null;
                    }),
                    itemPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    borderRadius: 15,
                    spacing: 4,
                    items: const [
                      SlidingPillItem(child: Text('全部', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F)))),
                      SlidingPillItem(child: Text('服务端', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F)))),
                      SlidingPillItem(child: Text('整合包', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F)))),
                      SlidingPillItem(child: Text('本地上传', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F)))),
                    ],
                  ),
                  if (_loadingModpacks && _filterIndex != 1 && _filterIndex != 3)
                    const CupertinoActivityIndicator(radius: 8),
                ],
              ),
              if (_errorText != null) ...[
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE11D48).withOpacity(0.08),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      const Icon(CupertinoIcons.exclamationmark_triangle_fill, size: 13, color: Color(0xFFE11D48)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _errorText!,
                          style: const TextStyle(fontSize: 12, color: Color(0xFF9F1239), fontWeight: FontWeight.w500),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 10),

              // Content List or Upload View
              Expanded(
                child: _filterIndex == 3
                    ? _buildUploadView()
                    : ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, __) => Divider(
                          height: 1,
                          thickness: 0.5,
                          color: Colors.black.withOpacity(0.04),
                        ),
                        itemBuilder: (context, idx) => _buildDenseRow(items[idx]),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDenseRow(MarketItem item) {
    final bool isExpanded = _expandedItemId == item.id;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _toggleExpand(item),
          child: MouseRegion(
            cursor: SystemMouseCursors.click,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              decoration: BoxDecoration(
                color: isExpanded ? Colors.black.withOpacity(0.035) : Colors.transparent,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  // Avatar / Icon
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      width: 36,
                      height: 36,
                      color: item.iconBg,
                      child: item.iconUrl != null && item.iconUrl!.isNotEmpty
                          ? Image.network(
                              item.iconUrl!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Icon(item.fallbackIcon, size: 18, color: const Color(0xFF334155)),
                            )
                          : Icon(item.fallbackIcon, size: 18, color: const Color(0xFF334155)),
                    ),
                  ),
                  const SizedBox(width: 12),

                  // Name + Version + Short Intro
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                item.title,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xFF151515)),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1.5),
                              decoration: BoxDecoration(
                                color: Colors.black.withOpacity(0.045),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                item.badgeVersion,
                                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, fontFamily: WindowService.monoFont, color: Colors.black.withOpacity(0.55)),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              item.category == 'core' ? '核心' : '整合包',
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.38)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 12, color: Colors.black.withOpacity(0.45)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),

                  if (item.downloads != null) ...[
                    Text(
                      _formatDownloads(item.downloads),
                      style: TextStyle(fontSize: 11, fontFamily: WindowService.monoFont, color: Colors.black.withOpacity(0.38)),
                    ),
                    const SizedBox(width: 8),
                  ],
                  AnimatedRotation(
                    turns: isExpanded ? 0.25 : 0.0,
                    duration: const Duration(milliseconds: 180),
                    child: Icon(CupertinoIcons.chevron_right, size: 13, color: Colors.black.withOpacity(0.3)),
                  ),
                ],
              ),
            ),
          ),
        ),

        // Smooth Inline Expandable Deployment Form
        AnimatedSize(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: isExpanded ? _buildExpandedConfig(item) : const SizedBox.shrink(),
        ),
      ],
    );
  }

  Widget _buildExpandedConfig(MarketItem item) {
    return Container(
      margin: const EdgeInsets.only(left: 10, right: 10, bottom: 10, top: 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.03),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Version Selector
          Row(
            children: [
              Text('版本', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
              const SizedBox(width: 8),
              if (_loadingVersions) const CupertinoActivityIndicator(radius: 7),
            ],
          ),
          const SizedBox(height: 8),
          if (item.category == 'core')
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: _versions.map((v) {
                final sel = _selectedVersion == v;
                return RippleButton(
                  isSelected: sel,
                  borderRadius: BorderRadius.circular(10),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  onTap: () => setState(() {
                    _selectedVersion = v;
                    _nameCtrl.text = '${item.id}-$v';
                  }),
                  child: Text(v, style: TextStyle(fontSize: 11, fontFamily: WindowService.monoFont, fontWeight: sel ? FontWeight.w700 : FontWeight.w500)),
                );
              }).toList(),
            )
          else
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: _modpackVersions.take(10).map((mv) {
                final vid = mv['id']?.toString() ?? '';
                final sel = _selectedModpackVersionId == vid;
                final gvs = mv['gameVersions'] as List?;
                final gv = (gvs != null && gvs.isNotEmpty) ? gvs.first.toString() : '';
                return RippleButton(
                  isSelected: sel,
                  borderRadius: BorderRadius.circular(10),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  onTap: () => setState(() {
                    _selectedModpackVersionId = vid;
                    if (gv.isNotEmpty) _selectedVersion = gv;
                  }),
                  child: Text(
                    '${mv['versionNumber'] ?? ''} ${gv.isNotEmpty ? '($gv)' : ''}',
                    style: TextStyle(fontSize: 11, fontFamily: WindowService.monoFont, fontWeight: sel ? FontWeight.w700 : FontWeight.w500),
                  ),
                );
              }).toList(),
            ),
          const SizedBox(height: 14),

          // Name + Mode
          Row(
            children: [
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('名称', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.7),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: TextField(
                        controller: _nameCtrl,
                        style: const TextStyle(fontSize: 12, color: Color(0xFF151515)),
                        decoration: const InputDecoration(border: InputBorder.none, isDense: true, contentPadding: EdgeInsets.symmetric(vertical: 6)),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('模式', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        ('survival', '生存'),
                        ('creative', '创造'),
                        ('adventure', '冒险'),
                      ].map((gm) {
                        return Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(right: 4),
                            child: RippleButton(
                              isSelected: _gamemode == gm.$1,
                              borderRadius: BorderRadius.circular(10),
                              padding: const EdgeInsets.symmetric(vertical: 7),
                              onTap: () => setState(() => _gamemode = gm.$1),
                              child: Center(child: Text(gm.$2, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600))),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          MemorySlider(
            valueMB: _selectedMemory,
            onChanged: (v) => setState(() => _selectedMemory = v),
          ),
          const SizedBox(height: 8),

          // Online Mode + Deploy Button
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              RippleButton(
                isSelected: _onlineMode,
                borderRadius: BorderRadius.circular(12),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                onTap: () => setState(() => _onlineMode = !_onlineMode),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _onlineMode ? CupertinoIcons.checkmark_circle_fill : CupertinoIcons.circle,
                      size: 13,
                      color: _onlineMode ? const Color(0xFF151515) : Colors.black.withOpacity(0.3),
                    ),
                    const SizedBox(width: 5),
                    const Text('正版验证', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              RippleButton(
                isSelected: true,
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                onTap: _deploying ? null : () => _deployItem(item),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_deploying) ...[
                      const CupertinoActivityIndicator(radius: 7),
                      const SizedBox(width: 6),
                    ],
                    const Text('立即部署', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF151515))),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildUploadView() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 10),
          RippleButton(
            isSelected: _uploadFilePath != null,
            borderRadius: BorderRadius.circular(18),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 30),
            onTap: () async {
              final path = await WindowService.pickFile(extensions: ['jar', 'zip']);
              if (path != null && mounted) {
                setState(() {
                  _uploadFilePath = path;
                  if (_uploadNameCtrl.text.trim().isEmpty) {
                    _uploadNameCtrl.text = WindowService.fileName(path).replaceAll(RegExp(r'\.(jar|zip)$', caseSensitive: false), '');
                  }
                });
              }
            },
            child: SizedBox(
              width: double.infinity,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _uploadFilePath != null ? CupertinoIcons.doc_checkmark : CupertinoIcons.arrow_up_doc,
                    size: 26,
                    color: const Color(0xFF1F1F1F),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _uploadFilePath != null ? WindowService.fileName(_uploadFilePath!) : '选择本地服务端 (.jar / .zip)',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('名称', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.045),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: TextField(
                        controller: _uploadNameCtrl,
                        style: const TextStyle(fontSize: 13, color: Color(0xFF151515)),
                        decoration: const InputDecoration(
                          border: InputBorder.none,
                          hintText: '服务器名称',
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 7),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('模式', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        ('survival', '生存'),
                        ('creative', '创造'),
                        ('adventure', '冒险'),
                      ].map((gm) {
                        return Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(right: 4),
                            child: RippleButton(
                              isSelected: _gamemode == gm.$1,
                              borderRadius: BorderRadius.circular(10),
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              onTap: () => setState(() => _gamemode = gm.$1),
                              child: Center(child: Text(gm.$2, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600))),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          MemorySlider(
            valueMB: _selectedMemory,
            onChanged: (v) => setState(() => _selectedMemory = v),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              RippleButton(
                isSelected: _onlineMode,
                borderRadius: BorderRadius.circular(12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                onTap: () => setState(() => _onlineMode = !_onlineMode),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _onlineMode ? CupertinoIcons.checkmark_circle_fill : CupertinoIcons.circle,
                      size: 14,
                      color: _onlineMode ? const Color(0xFF151515) : Colors.black.withOpacity(0.35),
                    ),
                    const SizedBox(width: 6),
                    const Text('正版验证', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              RippleButton(
                isSelected: true,
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
                onTap: (_deploying || _uploadFilePath == null)
                    ? null
                    : () async {
                        setState(() {
                          _deploying = true;
                          _errorText = null;
                        });
                        final ok = await ApiService.uploadCustomServer(
                          filePath: _uploadFilePath!,
                          name: _uploadNameCtrl.text.trim().isEmpty ? 'custom-server' : _uploadNameCtrl.text.trim(),
                          maxMemory: _selectedMemory,
                          gamemode: _gamemode,
                          onlineMode: _onlineMode,
                        );
                        if (mounted) {
                          setState(() {
                            _deploying = false;
                            if (!ok) {
                              _errorText = ApiService.lastError ?? '上传失败，请检查文件后重试';
                            }
                          });
                          if (ok) widget.onDeployed();
                        }
                      },
                child: _deploying
                    ? const CupertinoActivityIndicator(radius: 7)
                    : const Text('上传并部署', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
