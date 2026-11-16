import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/server_model.dart';
import '../services/api_service.dart';
import '../services/window_service.dart';
import '../widgets/ripple_button.dart';
import '../widgets/sliding_pill_bar.dart';

class NetworkPage extends StatefulWidget {
  const NetworkPage({super.key});

  @override
  State<NetworkPage> createState() => _NetworkPageState();
}

class _NetworkPageState extends State<NetworkPage> {
  int _modeIndex = 0; // 0: 本地, 1: IPv6, 2: P2P
  String _lanIp = '127.0.0.1';
  Map<String, dynamic> _ipv6Diag = {'ip': null, 'address': null, 'checks': []};
  bool _checkingIpv6 = false;

  List<ServerInfo> _servers = [];
  ServerInfo? _selectedServer;

  // Real P2P Host State
  Map<String, dynamic> _p2pStatus = {'active': false, 'status': 'idle'};
  Timer? _p2pPollTimer;
  bool _copied = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _p2pPollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    final servers = await ApiService.getServers();
    final lan = await ApiService.getLanIp();
    if (!mounted) return;

    ServerInfo? target;
    if (servers.isNotEmpty) {
      target = servers.firstWhere((s) => s.isRunning, orElse: () => servers.first);
    }

    setState(() {
      _servers = servers;
      _lanIp = lan;
      _selectedServer = target;
    });

    await _runIpv6Diag();
    await _refreshP2pStatus();
  }

  String get _targetId => _selectedServer?.id ?? 'default';
  int get _port => _selectedServer?.port ?? 25565;

  Future<void> _runIpv6Diag() async {
    setState(() => _checkingIpv6 = true);
    final res = await ApiService.diagnoseIpv6(port: _port, serverId: _selectedServer?.id);
    if (mounted) {
      setState(() {
        _ipv6Diag = res;
        _checkingIpv6 = false;
      });
    }
  }

  Future<void> _refreshP2pStatus() async {
    final st = await ApiService.getP2pHostStatus(_targetId);
    if (mounted) {
      setState(() => _p2pStatus = st);
      if (st['active'] == true) {
        _startP2pPolling();
      }
    }
  }

  void _startP2pPolling() {
    _p2pPollTimer?.cancel();
    _p2pPollTimer = Timer.periodic(const Duration(milliseconds: 1200), (_) async {
      final st = await ApiService.getP2pHostStatus(_targetId);
      if (mounted) setState(() => _p2pStatus = st);
      if (st['active'] != true) _p2pPollTimer?.cancel();
    });
  }

  Future<void> _toggleP2P() async {
    if (_p2pStatus['active'] == true) {
      _p2pPollTimer?.cancel();
      await ApiService.stopP2pHost(_targetId);
      if (mounted) setState(() => _p2pStatus = {'active': false, 'status': 'idle'});
    } else {
      final res = await ApiService.startP2pHost(_targetId, _port);
      if (mounted) {
        setState(() => _p2pStatus = res);
        _startP2pPolling();
      }
    }
  }

  void _copy(String text) {
    Clipboard.setData(ClipboardData(text: text));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
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
                    '联机',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFF151515), letterSpacing: -0.5),
                  ),
                  SlidingPillBar(
                    selectedIndex: _modeIndex,
                    onChanged: (idx) {
                      setState(() => _modeIndex = idx);
                      if (idx == 1) _runIpv6Diag();
                    },
                    itemPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    borderRadius: 16,
                    spacing: 4,
                    items: const [
                      SlidingPillItem(child: Text('本地', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515)))),
                      SlidingPillItem(child: Text('IPv6', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515)))),
                      SlidingPillItem(child: Text('P2P', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515)))),
                    ],
                  ),
                ],
              ),
              if (_servers.isNotEmpty) ...[
                const SizedBox(height: 12),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _servers.map((s) {
                      final isSel = _selectedServer?.id == s.id;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: RippleButton(
                          isSelected: isSel,
                          borderRadius: BorderRadius.circular(14),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          onTap: () {
                            setState(() => _selectedServer = s);
                            _runIpv6Diag();
                            _refreshP2pStatus();
                          },
                          child: Text(
                            '${s.name} (:${s.port})',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: isSel ? FontWeight.w600 : FontWeight.w500,
                              color: const Color(0xFF151515),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  switchInCurve: Curves.easeOutCubic,
                  child: KeyedSubtree(
                    key: ValueKey('${_modeIndex}_$_targetId'),
                    child: switch (_modeIndex) {
                      0 => _buildLanView(),
                      1 => _buildIpv6View(),
                      _ => _buildP2pView(),
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

  Widget _buildLanView() {
    final address = '$_lanIp:$_port';
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(CupertinoIcons.wifi, size: 28, color: Color(0xFF1F1F1F)),
          const SizedBox(height: 14),
          const Text('本地局域网', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFF151515))),
          const SizedBox(height: 18),
          SelectableText(
            address,
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, fontFamily: WindowService.monoFont, color: const Color(0xFF151515)),
          ),
          const SizedBox(height: 22),
          RippleButton(
            onTap: () => _copy(address),
            isSelected: true,
            borderRadius: BorderRadius.circular(16),
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(_copied ? CupertinoIcons.checkmark_alt : CupertinoIcons.doc_on_doc, size: 14, color: const Color(0xFF151515)),
                const SizedBox(width: 7),
                Text(_copied ? '已复制' : '复制地址', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIpv6View() {
    final String? address = _ipv6Diag['address']?.toString();
    final List checks = (_ipv6Diag['checks'] as List?) ?? [];

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('公网 IPv6 地址', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
                    const SizedBox(height: 6),
                    SelectableText(
                      address ?? '未检测到可用公网 IPv6',
                      style: TextStyle(
                        fontSize: address != null ? 16 : 14,
                        fontWeight: FontWeight.w700,
                        fontFamily: WindowService.monoFont,
                        color: address != null ? const Color(0xFF151515) : const Color(0xFFE11D48),
                      ),
                    ),
                  ],
                ),
              ),
              if (address != null)
                RippleButton(
                  isSelected: true,
                  onTap: () => _copy(address),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  child: Text(_copied ? '已复制' : '复制', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                ),
              const SizedBox(width: 6),
              RippleButton(
                onTap: _checkingIpv6 ? null : _runIpv6Diag,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: _checkingIpv6
                    ? const CupertinoActivityIndicator(radius: 7)
                    : const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(CupertinoIcons.arrow_clockwise, size: 13),
                          SizedBox(width: 5),
                          Text('重新检测', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                        ],
                      ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Divider(height: 1, thickness: 0.5, color: Colors.black.withOpacity(0.05)),
          const SizedBox(height: 14),
          Text('连通性体检', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
          const SizedBox(height: 10),
          ...checks.map((c) {
            final status = c['status']?.toString() ?? 'warn';
            final Color color = status == 'ok'
                ? const Color(0xFF059669)
                : (status == 'error' ? const Color(0xFFE11D48) : const Color(0xFFD97706));
            final IconData icon = status == 'ok'
                ? CupertinoIcons.checkmark_circle_fill
                : (status == 'error' ? CupertinoIcons.xmark_circle_fill : CupertinoIcons.exclamationmark_triangle_fill);

            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 7),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Icon(icon, size: 15, color: color),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(c['label']?.toString() ?? '', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
                        const SizedBox(height: 2),
                        Text(c['detail']?.toString() ?? '', style: TextStyle(fontSize: 12, color: Colors.black.withOpacity(0.55))),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildP2pView() {
    final bool active = _p2pStatus['active'] == true;
    final String status = _p2pStatus['status']?.toString() ?? 'idle';
    final String transport = _p2pStatus['transport']?.toString() ?? 'p2p';
    final String roomCode = _p2pStatus['roomCode']?.toString() ?? '';
    final String natType = _p2pStatus['natType']?.toString() ?? 'unknown';
    final bool vpsConnected = _p2pStatus['vpsConnected'] == true;
    final int peersCount = _p2pStatus['peersCount'] is int ? _p2pStatus['peersCount'] : 0;
    final String? err = _p2pStatus['error']?.toString();

    String statusLabel = '未开启';
    Color statusColor = Colors.black.withOpacity(0.45);
    if (status == 'stun') {
      statusLabel = 'STUN 公网探测中...';
      statusColor = const Color(0xFF0284C7);
    } else if (status == 'waiting_peer') {
      statusLabel = vpsConnected
          ? '房间已就绪 · 支持直连与对称 NAT 中继兜底'
          : '房间已就绪 · 等待玩家输入房间码';
      statusColor = const Color(0xFF059669);
    } else if (status == 'punching') {
      statusLabel = '正在进行 NAT 端口预测打洞...';
      statusColor = const Color(0xFFD97706);
    } else if (status == 'connected') {
      statusLabel = transport == 'relay'
          ? '已通过中继兜底连通 · $peersCount 位玩家'
          : 'P2P 已打通 · $peersCount 位玩家直连中';
      statusColor = const Color(0xFF059669);
    } else if (status == 'error') {
      statusLabel = err ?? 'P2P 启动失败';
      statusColor = const Color(0xFFE11D48);
    }

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(CupertinoIcons.arrow_right_arrow_left, size: 28, color: Color(0xFF1F1F1F)),
          const SizedBox(height: 14),
          const Text('P2P 直连隧道', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Color(0xFF151515))),
          const SizedBox(height: 16),
          if (active) ...[
            SelectableText(
              roomCode,
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w800,
                fontFamily: WindowService.monoFont,
                letterSpacing: 3,
                color: const Color(0xFF151515),
              ),
            ),
            const SizedBox(height: 10),
            Text(statusLabel, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: statusColor)),
            const SizedBox(height: 6),
            if (_p2pStatus['pubIp'] != null)
              Text(
                'NAT: ${natType == 'symmetric' ? '对称型 (已启用中继兜底)' : '锥形 (适合直连)'} · ${_p2pStatus['pubIp']}:${_p2pStatus['pubPort']}',
                style: TextStyle(fontSize: 11, fontFamily: WindowService.monoFont, color: Colors.black.withOpacity(0.4)),
              ),
            const SizedBox(height: 22),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                RippleButton(
                  onTap: () => _copy(roomCode),
                  isSelected: true,
                  borderRadius: BorderRadius.circular(16),
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(_copied ? CupertinoIcons.checkmark_alt : CupertinoIcons.doc_on_doc, size: 14, color: const Color(0xFF151515)),
                      const SizedBox(width: 6),
                      Text(_copied ? '已复制' : '复制房间码', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                RippleButton(
                  onTap: _toggleP2P,
                  borderRadius: BorderRadius.circular(16),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  child: const Text('关闭隧道', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                ),
              ],
            ),
          ] else
            RippleButton(
              onTap: _toggleP2P,
              isSelected: true,
              borderRadius: BorderRadius.circular(16),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 11),
              child: const Text('开启 P2P 房间', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF151515))),
            ),
        ],
      ),
    );
  }
}
