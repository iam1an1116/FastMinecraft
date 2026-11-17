import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../models/server_model.dart';
import '../services/api_service.dart';
import '../services/window_service.dart';
import '../services/ws_service.dart';
import '../widgets/desktop_header.dart';
import '../widgets/ripple_button.dart';

class ServerDetailPage extends StatefulWidget {
  final ServerInfo server;
  final ServerDetailTab currentTab;
  final VoidCallback? onServerDeleted;

  const ServerDetailPage({
    super.key,
    required this.server,
    required this.currentTab,
    this.onServerDeleted,
  });

  @override
  State<ServerDetailPage> createState() => _ServerDetailPageState();
}

class _ServerDetailPageState extends State<ServerDetailPage> {
  final WsService _wsService = WsService();
  final List<String> _logs = [];
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _cmdController = TextEditingController();

  late String _status;
  late int _currentPort;
  String? _errorMessage;
  Map<String, dynamic>? _stats;
  List<dynamic> _players = [];
  List<dynamic> _mods = [];
  List<dynamic> _backups = [];
  Map<String, String> _properties = {};
  final Map<String, TextEditingController> _propControllers = {};
  bool _loadingTab = false;
  bool _actionLoading = false;
  bool _savingProps = false;
  Timer? _statsTimer;

  @override
  void initState() {
    super.initState();
    _status = widget.server.status;
    _currentPort = widget.server.port;
    _errorMessage = widget.server.downloadError;
    _wsService.connect(widget.server.id);
    _wsService.logStream.listen((line) {
      if (!mounted) return;
      setState(() {
        _logs.add(line);
        if (_logs.length > 500) _logs.removeAt(0);
      });
      Future.delayed(const Duration(milliseconds: 40), () {
        if (_scrollController.hasClients) {
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
        }
      });
    });
    _wsService.statusStream.listen((newStatus) {
      if (mounted) setState(() => _status = newStatus);
    });
    _wsService.statsStream.listen((newStats) {
      if (mounted) setState(() => _stats = newStats);
    });

    _loadLogsHistory();
    _refreshStatusAndStats();
    _statsTimer = Timer.periodic(const Duration(seconds: 3), (_) => _refreshStatusAndStats());
    _loadCurrentTabData();
  }

  Future<void> _loadLogsHistory() async {
    final history = await ApiService.getServerLogs(widget.server.id);
    if (!mounted || history.isEmpty) return;
    setState(() {
      _logs.clear();
      _logs.addAll(history);
    });
    Future.delayed(const Duration(milliseconds: 40), () {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  @override
  void didUpdateWidget(covariant ServerDetailPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.server.id != widget.server.id) {
      _logs.clear();
      _status = widget.server.status;
      _currentPort = widget.server.port;
      _errorMessage = widget.server.downloadError;
      _wsService.connect(widget.server.id);
      _loadLogsHistory();
      _refreshStatusAndStats();
      _loadCurrentTabData();
    } else if (oldWidget.currentTab != widget.currentTab) {
      _loadCurrentTabData();
    }
  }

  Future<void> _refreshStatusAndStats() async {
    final s = await ApiService.getStats(widget.server.id);
    final info = await ApiService.getServer(widget.server.id);
    if (mounted) {
      setState(() {
        if (s != null) _stats = s;
        if (info != null) {
          _status = info.status;
          _currentPort = info.port;
          if (info.downloadError != null) {
            _errorMessage = info.downloadError;
          } else if (info.isRunning || info.isStopped) {
            // Clear stale download error once recovered/stopped unless set by user action
          }
        }
      });
    }
  }

  Future<void> _loadCurrentTabData() async {
    setState(() => _loadingTab = true);
    if (widget.currentTab == ServerDetailTab.players) {
      final p = await ApiService.getPlayers(widget.server.id);
      if (mounted) setState(() => _players = p);
    } else if (widget.currentTab == ServerDetailTab.mods) {
      final m = await ApiService.getMods(widget.server.id);
      if (mounted) setState(() => _mods = m);
    } else if (widget.currentTab == ServerDetailTab.backups) {
      final b = await ApiService.getBackups(widget.server.id);
      if (mounted) setState(() => _backups = b);
    } else if (widget.currentTab == ServerDetailTab.config) {
      final props = await ApiService.getServerProperties(widget.server.id);
      if (mounted) {
        setState(() {
          _properties = props;
          _syncPropControllers();
        });
      }
    }
    if (mounted) setState(() => _loadingTab = false);
  }

  void _syncPropControllers() {
    for (final key in ['motd', 'max-players', 'server-port', 'view-distance']) {
      _propControllers[key] ??= TextEditingController();
      _propControllers[key]!.text = _properties[key] ?? '';
    }
  }

  @override
  void dispose() {
    _statsTimer?.cancel();
    _wsService.dispose();
    _scrollController.dispose();
    _cmdController.dispose();
    for (final c in _propControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _sendCommand() {
    final cmd = _cmdController.text.trim();
    if (cmd.isEmpty) return;
    _wsService.sendCommand(cmd);
    setState(() => _logs.add('> $cmd'));
    _cmdController.clear();
  }

  Future<void> _powerAction(Future<bool> Function(String) fn) async {
    setState(() {
      _actionLoading = true;
      _errorMessage = null;
    });
    final ok = await fn(widget.server.id);
    if (!ok && mounted) {
      final err = ApiService.lastError ?? '操作失败';
      setState(() {
        _errorMessage = err;
        _logs.add('[错误] $err');
      });
    }
    await _refreshStatusAndStats();
    if (mounted) setState(() => _actionLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 880),
          padding: const EdgeInsets.symmetric(horizontal: 36, vertical: 18),
          child: Column(
            children: [
              _buildStatsBar(),
              Divider(height: 20, thickness: 0.5, color: Colors.black.withOpacity(0.05)),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  switchInCurve: Curves.easeOutCubic,
                  child: KeyedSubtree(
                    key: ValueKey(widget.currentTab),
                    child: switch (widget.currentTab) {
                      ServerDetailTab.console => _buildConsoleTab(),
                      ServerDetailTab.players => _buildPlayersTab(),
                      ServerDetailTab.mods => _buildModsTab(),
                      ServerDetailTab.backups => _buildBackupsTab(),
                      ServerDetailTab.config => _buildConfigTab(),
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatsBar() {
    final cpu = _stats?['cpu'] ?? 0;
    final ram = _stats?['memoryUsed'] ?? _stats?['memory'] ?? 0;
    final tps = _stats?['tps'] ?? 20.0;
    final bool isRunning = _status == 'running';
    final bool isStarting = _status == 'starting';
    final bool isDownloading = _status == 'downloading';

    Color statusColor = Colors.black.withOpacity(0.35);
    String statusLabel = '已停止';
    if (isRunning) {
      statusColor = const Color(0xFF059669);
      statusLabel = '运行中';
    } else if (isStarting) {
      statusColor = const Color(0xFFD97706);
      statusLabel = '启动中';
    } else if (isDownloading) {
      statusColor = const Color(0xFF0284C7);
      statusLabel = '下载中';
    } else if (_status == 'error') {
      statusColor = const Color(0xFFE11D48);
      statusLabel = '部署失败';
    } else if (_status == 'crashed') {
      statusColor = const Color(0xFFE11D48);
      statusLabel = '已崩溃';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            _buildStatItem('状态', statusLabel, statusColor),
            const SizedBox(width: 28),
            _buildStatItem('CPU', '$cpu%', const Color(0xFF151515)),
            const SizedBox(width: 28),
            _buildStatItem('内存', '$ram MB', const Color(0xFF151515)),
            const SizedBox(width: 28),
            _buildStatItem('TPS', '$tps', const Color(0xFF151515)),
            const SizedBox(width: 28),
            _buildStatItem('端口', '$_currentPort', const Color(0xFF151515)),
            const Spacer(),
            if (_actionLoading)
              const CupertinoActivityIndicator(radius: 9)
            else if (isRunning || isStarting) ...[
              RippleButton(
                onTap: () => _powerAction(ApiService.stopServer),
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(CupertinoIcons.stop_fill, size: 11, color: Color(0xFFE11D48)),
                    SizedBox(width: 5),
                    Text('停止', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              RippleButton(
                onTap: () => _powerAction(ApiService.forceStopServer),
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                child: Text('强停', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.55))),
              ),
              const SizedBox(width: 4),
              RippleButton(
                onTap: () => _powerAction(ApiService.restartServer),
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(CupertinoIcons.arrow_2_circlepath, size: 12, color: Color(0xFF1F1F1F)),
                    SizedBox(width: 5),
                    Text('重启', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                  ],
                ),
              ),
            ] else ...[
              RippleButton(
                onTap: isDownloading ? null : () => _powerAction(ApiService.startServer),
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      CupertinoIcons.play_fill,
                      size: 11,
                      color: isDownloading ? Colors.black.withOpacity(0.28) : const Color(0xFF059669),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      isDownloading ? '准备中' : '启动',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: isDownloading ? Colors.black.withOpacity(0.35) : const Color(0xFF059669),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
        if (_errorMessage != null && _errorMessage!.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
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
                    _errorMessage!,
                    style: const TextStyle(fontSize: 12, color: Color(0xFF9F1239), fontWeight: FontWeight.w500),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildStatItem(String label, String value, Color valueColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: Colors.black.withOpacity(0.38))),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: valueColor, fontFamily: WindowService.monoFont)),
      ],
    );
  }

  Widget _buildConsoleTab() {
    return Column(
      children: [
        Expanded(
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.03),
              borderRadius: BorderRadius.circular(14),
            ),
            child: _logs.isEmpty
                ? Center(
                    child: Text(
                      _status == 'running' ? '等待日志输出...' : '服务器未运行',
                      style: TextStyle(fontSize: 12, color: Colors.black.withOpacity(0.35), fontFamily: WindowService.monoFont),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    itemCount: _logs.length,
                    itemBuilder: (context, i) {
                      final line = _logs[i];
                      Color lineColor = const Color(0xFF222222);
                      if (line.contains('ERROR') || line.contains('Exception')) {
                        lineColor = const Color(0xFFDC2626);
                      } else if (line.contains('WARN')) {
                        lineColor = const Color(0xFFD97706);
                      } else if (line.startsWith('> ')) {
                        lineColor = const Color(0xFF2563EB);
                      }
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 1.5),
                        child: SelectableText(
                          line,
                          style: TextStyle(
                            color: lineColor,
                            fontSize: 12,
                            fontFamily: WindowService.monoFont,
                            height: 1.4,
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.04),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Text('>', style: TextStyle(color: Colors.black.withOpacity(0.35), fontWeight: FontWeight.bold, fontFamily: WindowService.monoFont)),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _cmdController,
                  style: TextStyle(fontSize: 13, color: const Color(0xFF151515), fontFamily: WindowService.monoFont),
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    hintText: '输入指令',
                    hintStyle: TextStyle(fontSize: 12, color: Colors.black.withOpacity(0.3)),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                  onSubmitted: (_) => _sendCommand(),
                ),
              ),
              RippleButton(
                onTap: _sendCommand,
                borderRadius: BorderRadius.circular(12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: const Text('发送', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPlayersTab() {
    if (_loadingTab) return const Center(child: CupertinoActivityIndicator());
    if (_players.isEmpty) {
      return Center(child: Text('暂无在线玩家', style: TextStyle(fontSize: 13, color: Colors.black.withOpacity(0.4))));
    }
    return ListView.separated(
      itemCount: _players.length,
      separatorBuilder: (_, __) => Divider(height: 1, thickness: 0.5, color: Colors.black.withOpacity(0.045)),
      itemBuilder: (context, i) {
        final p = _players[i];
        final name = p is Map ? (p['name']?.toString() ?? '玩家') : p.toString();
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  RippleButton(
                    onTap: () => ApiService.opPlayer(widget.server.id, name),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    child: const Text('OP', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                  ),
                  RippleButton(
                    onTap: () async {
                      await ApiService.kickPlayer(widget.server.id, name);
                      _loadCurrentTabData();
                    },
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    child: const Text('踢出', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFD97706))),
                  ),
                  RippleButton(
                    onTap: () async {
                      await ApiService.banPlayer(widget.server.id, name);
                      _loadCurrentTabData();
                    },
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    child: const Text('封禁', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildModsTab() {
    if (_loadingTab) return const Center(child: CupertinoActivityIndicator());
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            RippleButton(
              onTap: () async {
                final path = await WindowService.pickFile(extensions: ['jar']);
                if (path != null) {
                  await ApiService.uploadMod(widget.server.id, path);
                  _loadCurrentTabData();
                }
              },
              borderRadius: BorderRadius.circular(14),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.add, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('上传 Mod', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: _mods.isEmpty
              ? Center(child: Text('暂无 Mod', style: TextStyle(fontSize: 13, color: Colors.black.withOpacity(0.4))))
              : ListView.separated(
                  itemCount: _mods.length,
                  separatorBuilder: (_, __) => Divider(height: 1, thickness: 0.5, color: Colors.black.withOpacity(0.045)),
                  itemBuilder: (context, i) {
                    final m = _mods[i];
                    final id = m['id']?.toString() ?? m['file_name']?.toString() ?? m['filename']?.toString() ?? '';
                    final enabled = m['enabled'] == true || m['enabled'] == 1;
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              m['name']?.toString() ?? m['file_name']?.toString() ?? m['filename']?.toString() ?? 'Mod',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: enabled ? const Color(0xFF151515) : Colors.black.withOpacity(0.35),
                              ),
                            ),
                          ),
                          RippleButton(
                            isSelected: enabled,
                            onTap: () async {
                              await ApiService.toggleMod(widget.server.id, id, !enabled);
                              _loadCurrentTabData();
                            },
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            child: Text(enabled ? '已启用' : '已禁用', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                          ),
                          const SizedBox(width: 4),
                          RippleButton(
                            onTap: () async {
                              await ApiService.deleteMod(widget.server.id, id);
                              _loadCurrentTabData();
                            },
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            child: const Text('删除', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildBackupsTab() {
    if (_loadingTab) return const Center(child: CupertinoActivityIndicator());
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            RippleButton(
              onTap: () async {
                setState(() => _loadingTab = true);
                await ApiService.createBackup(widget.server.id, 'world');
                await _loadCurrentTabData();
              },
              borderRadius: BorderRadius.circular(14),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(CupertinoIcons.add, size: 13, color: Color(0xFF1F1F1F)),
                  SizedBox(width: 5),
                  Text('创建存档备份', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: _backups.isEmpty
              ? Center(child: Text('暂无备份', style: TextStyle(fontSize: 13, color: Colors.black.withOpacity(0.4))))
              : ListView.separated(
                  itemCount: _backups.length,
                  separatorBuilder: (_, __) => Divider(height: 1, thickness: 0.5, color: Colors.black.withOpacity(0.045)),
                  itemBuilder: (context, i) {
                    final b = _backups[i];
                    final bid = b['id']?.toString() ?? '';
                    final rawType = b['type']?.toString() ?? 'world';
                    final typeLabel = switch (rawType) {
                      'full' => '完整备份',
                      'plugin' => '插件备份',
                      'config' => '配置备份',
                      _ => '存档备份',
                    };
                    final sizeBytes = b['file_size'] is int
                        ? (b['file_size'] as int)
                        : int.tryParse(b['file_size']?.toString() ?? '') ?? 0;
                    final sizeStr = sizeBytes > 0 ? ' · ${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB' : '';
                    final created = b['created_at']?.toString() ?? '';
                    final dateStr = created.length >= 16
                        ? ' · ${created.substring(0, 16).replaceAll('T', ' ')}'
                        : (created.isNotEmpty ? ' · $created' : '');
                    final backupLabel = b['filename']?.toString() ?? b['name']?.toString() ?? '$typeLabel$sizeStr$dateStr';
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              backupLabel,
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515)),
                            ),
                          ),
                          RippleButton(
                            onTap: () async {
                              final ok = await ApiService.restoreBackup(widget.server.id, bid);
                              if (!ok && mounted) {
                                setState(() => _errorMessage = ApiService.lastError ?? '恢复备份失败');
                              }
                              _loadCurrentTabData();
                            },
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            child: const Text('恢复', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                          ),
                          const SizedBox(width: 4),
                          RippleButton(
                            onTap: () async {
                              await ApiService.deleteBackup(widget.server.id, bid);
                              _loadCurrentTabData();
                            },
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            child: const Text('删除', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildConfigTab() {
    if (_loadingTab) return const Center(child: CupertinoActivityIndicator());
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildPropField('服务器描述 (MOTD)', 'motd'),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _buildPropField('最大玩家', 'max-players')),
              const SizedBox(width: 16),
              Expanded(child: _buildPropField('端口', 'server-port')),
              const SizedBox(width: 16),
              Expanded(child: _buildPropField('视距', 'view-distance')),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _buildPropToggle('正版验证', 'online-mode'),
              _buildPropToggle('PVP', 'pvp'),
              _buildPropToggle('白名单', 'white-list'),
              _buildPropToggle('命令方块', 'enable-command-block'),
              _buildPropToggle('允许飞行', 'allow-flight'),
              _buildPropToggle('允许下界', 'allow-nether'),
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              RippleButton(
                onTap: () async {
                  await ApiService.deleteServer(widget.server.id);
                  widget.onServerDeleted?.call();
                },
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                child: const Text('删除服务器', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
              ),
              RippleButton(
                isSelected: true,
                onTap: _savingProps
                    ? null
                    : () async {
                        setState(() {
                          _savingProps = true;
                          _errorMessage = null;
                        });
                        for (final entry in _propControllers.entries) {
                          if (entry.value.text.isNotEmpty) {
                            _properties[entry.key] = entry.value.text;
                          }
                        }
                        final ok = await ApiService.updateServerProperties(widget.server.id, _properties);
                        final parsedPort = int.tryParse(_properties['server-port'] ?? '');
                        if (parsedPort != null && parsedPort >= 1 && parsedPort <= 65535 && parsedPort != _currentPort) {
                          await ApiService.updateServerConfig(widget.server.id, {'port': parsedPort});
                          if (mounted) setState(() => _currentPort = parsedPort);
                        }
                        if (!ok && mounted) {
                          setState(() => _errorMessage = ApiService.lastError ?? '保存配置失败');
                        }
                        if (mounted) setState(() => _savingProps = false);
                      },
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 9),
                child: _savingProps
                    ? const CupertinoActivityIndicator(radius: 7)
                    : const Text('保存配置', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPropField(String label, String key) {
    final controller = _propControllers[key] ?? TextEditingController(text: _properties[key] ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.04),
            borderRadius: BorderRadius.circular(12),
          ),
          child: TextField(
            controller: controller,
            style: const TextStyle(fontSize: 13, color: Color(0xFF151515)),
            decoration: const InputDecoration(
              border: InputBorder.none,
              isDense: true,
              contentPadding: EdgeInsets.symmetric(vertical: 7),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPropToggle(String label, String key) {
    final bool val = (_properties[key] ?? 'false') == 'true';
    return RippleButton(
      isSelected: val,
      onTap: () => setState(() => _properties[key] = val ? 'false' : 'true'),
      borderRadius: BorderRadius.circular(14),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            val ? CupertinoIcons.checkmark_circle_fill : CupertinoIcons.circle,
            size: 14,
            color: val ? const Color(0xFF151515) : Colors.black.withOpacity(0.3),
          ),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
        ],
      ),
    );
  }
}
