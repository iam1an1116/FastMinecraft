import 'dart:async';
import 'dart:ui';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../models/server_model.dart';
import '../services/api_service.dart';
import '../widgets/memory_slider.dart';
import '../widgets/ripple_button.dart';

class ServersOverviewPage extends StatefulWidget {
  final Function(ServerInfo) onSelectServer;
  final VoidCallback onGoToMarket;

  const ServersOverviewPage({
    super.key,
    required this.onSelectServer,
    required this.onGoToMarket,
  });

  @override
  State<ServersOverviewPage> createState() => _ServersOverviewPageState();
}

class _ServersOverviewPageState extends State<ServersOverviewPage> {
  List<ServerInfo> _servers = [];
  bool _loading = true;
  String? _hoveredServerId;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _loadServers();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) => _loadServers(silent: true));
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadServers({bool silent = false}) async {
    try {
      final list = await ApiService.getServers();
      if (mounted) {
        setState(() {
          _servers = list;
          if (!silent) _loading = false;
        });
      }
    } catch (_) {
      if (mounted && !silent) setState(() => _loading = false);
    }
  }

  void _openQuickSettings(ServerInfo server) {
    showDialog(
      context: context,
      barrierColor: Colors.black.withOpacity(0.12),
      builder: (ctx) => _QuickServerSettingsDialog(
        server: server,
        onSaved: () => _loadServers(),
        onDeleted: () => _loadServers(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 820),
          padding: const EdgeInsets.symmetric(horizontal: 36, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    '服务器',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF151515),
                      letterSpacing: -0.5,
                    ),
                  ),
                  RippleButton(
                    onTap: widget.onGoToMarket,
                    borderRadius: BorderRadius.circular(18),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(CupertinoIcons.add, size: 14, color: Color(0xFF1F1F1F)),
                        SizedBox(width: 6),
                        Text(
                          '新建服务器',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Expanded(
                child: _loading
                    ? const Center(child: CupertinoActivityIndicator(radius: 11))
                    : _servers.isEmpty
                        ? _buildEmptyState()
                        : ListView.separated(
                            itemCount: _servers.length,
                            separatorBuilder: (_, __) => Divider(
                              height: 1,
                              thickness: 0.5,
                              color: Colors.black.withOpacity(0.045),
                            ),
                            itemBuilder: (context, index) => _buildServerRow(_servers[index]),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(CupertinoIcons.square_stack_3d_up, size: 32, color: Colors.black.withOpacity(0.25)),
          const SizedBox(height: 14),
          Text(
            '暂无服务器',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45)),
          ),
          const SizedBox(height: 12),
          RippleButton(
            onTap: widget.onGoToMarket,
            isSelected: true,
            borderRadius: BorderRadius.circular(16),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
            child: const Text(
              '前往市场',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildServerRow(ServerInfo s) {
    final bool isHovered = _hoveredServerId == s.id;

    Color statusDotColor;
    String statusText;
    if (s.isRunning) {
      statusDotColor = const Color(0xFF10B981);
      statusText = '运行中';
    } else if (s.isStarting) {
      statusDotColor = const Color(0xFFF59E0B);
      statusText = '启动中';
    } else if (s.status == 'downloading') {
      statusDotColor = const Color(0xFF0EA5E9);
      statusText = '下载中';
    } else {
      statusDotColor = Colors.black.withOpacity(0.32);
      statusText = '已停止';
    }

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hoveredServerId = s.id),
      onExit: (_) {
        if (_hoveredServerId == s.id) setState(() => _hoveredServerId = null);
      },
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => widget.onSelectServer(s),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: isHovered ? Colors.black.withOpacity(0.025) : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.045),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(CupertinoIcons.cube, size: 18, color: Color(0xFF222222)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          s.name,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF151515),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(color: statusDotColor, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 5),
                        Text(
                          statusText,
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: statusDotColor),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${s.version} · ${s.serverType} · ${s.port} · ${s.maxMemory}MB',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: Colors.black.withOpacity(0.42),
                        fontFamily: 'Menlo',
                      ),
                    ),
                  ],
                ),
              ),
              IgnorePointer(
                ignoring: !isHovered,
                child: AnimatedOpacity(
                  opacity: isHovered ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 150),
                  curve: Curves.easeOutCubic,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      RippleButton(
                        onTap: () => _openQuickSettings(s),
                        borderRadius: BorderRadius.circular(14),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(CupertinoIcons.slider_horizontal_3, size: 13, color: Color(0xFF1F1F1F)),
                            SizedBox(width: 5),
                            Text('设置', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                          ],
                        ),
                      ),
                      const SizedBox(width: 4),
                      RippleButton(
                        isSelected: true,
                        onTap: () => widget.onSelectServer(s),
                        borderRadius: BorderRadius.circular(14),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('进入', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                            SizedBox(width: 4),
                            Icon(CupertinoIcons.chevron_right, size: 12, color: Color(0xFF1F1F1F)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuickServerSettingsDialog extends StatefulWidget {
  final ServerInfo server;
  final VoidCallback onSaved;
  final VoidCallback onDeleted;

  const _QuickServerSettingsDialog({
    required this.server,
    required this.onSaved,
    required this.onDeleted,
  });

  @override
  State<_QuickServerSettingsDialog> createState() => _QuickServerSettingsDialogState();
}

class _QuickServerSettingsDialogState extends State<_QuickServerSettingsDialog> {
  late TextEditingController _nameCtrl;
  late TextEditingController _portCtrl;
  late int _maxMemory;
  bool _onlineMode = true;
  bool _loadingProps = true;
  bool _saving = false;
  bool _confirmDelete = false;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.server.name);
    _portCtrl = TextEditingController(text: widget.server.port.toString());
    _maxMemory = widget.server.maxMemory;
    _loadProps();
  }

  Future<void> _loadProps() async {
    final props = await ApiService.getServerProperties(widget.server.id);
    if (mounted) {
      setState(() {
        _onlineMode = (props['online-mode'] ?? 'true') == 'true';
        _loadingProps = false;
      });
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _portCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final port = int.tryParse(_portCtrl.text.trim()) ?? widget.server.port;
    await ApiService.updateServerConfig(widget.server.id, {
      'name': _nameCtrl.text.trim().isEmpty ? widget.server.name : _nameCtrl.text.trim(),
      'maxMemory': _maxMemory,
      'port': port,
    });
    final props = await ApiService.getServerProperties(widget.server.id);
    props['server-port'] = port.toString();
    props['online-mode'] = _onlineMode ? 'true' : 'false';
    await ApiService.updateServerProperties(widget.server.id, props);
    if (mounted) {
      widget.onSaved();
      Navigator.of(context).pop();
    }
  }

  Future<void> _delete() async {
    if (!_confirmDelete) {
      setState(() => _confirmDelete = true);
      return;
    }
    setState(() => _deleting = true);
    await ApiService.deleteServer(widget.server.id);
    if (mounted) {
      widget.onDeleted();
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
          child: Container(
            width: 420,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: const Color(0xFFE3E7EE).withOpacity(0.76),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: Colors.white.withOpacity(0.7),
                width: 1.0,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.12),
                  blurRadius: 32,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      widget.server.name,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Color(0xFF151515)),
                    ),
                    RippleButton(
                      onTap: () => Navigator.of(context).pop(),
                      padding: const EdgeInsets.all(6),
                      child: Icon(CupertinoIcons.xmark, size: 15, color: Colors.black.withOpacity(0.5)),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _fieldLabel('名称'),
                          const SizedBox(height: 6),
                          _inputBox(_nameCtrl),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _fieldLabel('端口'),
                          const SizedBox(height: 6),
                          _inputBox(_portCtrl),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                MemorySlider(
                  valueMB: _maxMemory,
                  onChanged: (val) => setState(() => _maxMemory = val),
                ),
                const SizedBox(height: 8),
                if (!_loadingProps)
                  RippleButton(
                    isSelected: _onlineMode,
                    borderRadius: BorderRadius.circular(12),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
                        const Text('正版验证', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
                      ],
                    ),
                  ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    RippleButton(
                      onTap: _deleting ? null : _delete,
                      borderRadius: BorderRadius.circular(14),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      child: _deleting
                          ? const CupertinoActivityIndicator(radius: 7)
                          : Text(
                              _confirmDelete ? '确认删除服务器' : '删除服务器',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFE11D48)),
                            ),
                    ),
                    RippleButton(
                      isSelected: true,
                      onTap: _saving ? null : _save,
                      borderRadius: BorderRadius.circular(14),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                      child: _saving
                          ? const CupertinoActivityIndicator(radius: 7)
                          : const Text('保存', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF151515))),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _fieldLabel(String t) => Text(
        t,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45)),
      );

  Widget _inputBox(TextEditingController c) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.045),
          borderRadius: BorderRadius.circular(12),
        ),
        child: TextField(
          controller: c,
          style: const TextStyle(fontSize: 13, color: Color(0xFF151515)),
          decoration: const InputDecoration(
            border: InputBorder.none,
            isDense: true,
            contentPadding: EdgeInsets.symmetric(vertical: 7),
          ),
        ),
      );
}
