import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api_service.dart';
import '../services/window_service.dart';
import '../widgets/ripple_button.dart';

class PlayerModePage extends StatefulWidget {
  const PlayerModePage({super.key});

  @override
  State<PlayerModePage> createState() => _PlayerModePageState();
}

class _PlayerModePageState extends State<PlayerModePage> {
  final TextEditingController _codeController = TextEditingController();
  Map<String, dynamic> _p2p = {'status': 'idle'};
  Timer? _pollTimer;
  bool _copied = false;

  @override
  void initState() {
    super.initState();
    _syncStatus();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _syncStatus() async {
    final st = await ApiService.getP2pPlayerStatus();
    if (mounted) {
      setState(() => _p2p = st);
      final s = st['status']?.toString();
      if (s != null && s != 'idle' && s != 'error') {
        _startPolling();
      }
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(milliseconds: 900), (_) async {
      final st = await ApiService.getP2pPlayerStatus();
      if (!mounted) return;
      setState(() => _p2p = st);
      if (st['status'] == 'idle' || st['status'] == 'error') {
        _pollTimer?.cancel();
      }
    });
  }

  Future<void> _handleConnect() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;

    final st = await ApiService.joinP2pRoom(code);
    if (mounted) {
      setState(() => _p2p = st);
      if (st['status'] != 'error') {
        _startPolling();
      }
    }
  }

  Future<void> _handleDisconnect() async {
    _pollTimer?.cancel();
    await ApiService.leaveP2pRoom();
    if (mounted) setState(() => _p2p = {'status': 'idle'});
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
    final String status = _p2p['status']?.toString() ?? 'idle';
    final bool isWorking = status == 'stun' || status == 'signaling' || status == 'punching';
    final bool isConnected = status == 'connected';
    final String? localAddress = _p2p['localAddress']?.toString();
    final int? pingMs = _p2p['pingMs'] is int ? _p2p['pingMs'] : null;
    final String? warningMsg = _p2p['warning']?.toString();
    final String? errorMsg = _p2p['error']?.toString();

    String statusLabel = '';
    if (status == 'stun') statusLabel = 'STUN 探测本机端口...';
    if (status == 'signaling') statusLabel = '查找房间信息...';
    if (status == 'punching') statusLabel = '正在进行 P2P NAT 打洞...';

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 440),
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(CupertinoIcons.game_controller, size: 32, color: Color(0xFF1F1F1F)),
              const SizedBox(height: 16),
              const Text(
                '加入联机',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Color(0xFF151515), letterSpacing: -0.4),
              ),
              const SizedBox(height: 26),
              if (!isConnected) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.045),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: TextField(
                    controller: _codeController,
                    textAlign: TextAlign.center,
                    textCapitalization: TextCapitalization.characters,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      fontFamily: WindowService.monoFont,
                      letterSpacing: 2,
                      color: const Color(0xFF151515),
                    ),
                    decoration: InputDecoration(
                      border: InputBorder.none,
                      hintText: 'FM-XXXX',
                      hintStyle: TextStyle(fontSize: 15, color: Colors.black.withOpacity(0.28), letterSpacing: 1),
                      isDense: true,
                    ),
                    onSubmitted: (_) => isWorking ? null : _handleConnect(),
                  ),
                ),
                if (isWorking) ...[
                  const SizedBox(height: 14),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CupertinoActivityIndicator(radius: 7),
                      const SizedBox(width: 8),
                      Text(statusLabel, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.55))),
                    ],
                  ),
                ] else if (status == 'error' && errorMsg != null) ...[
                  const SizedBox(height: 14),
                  Text(errorMsg, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                ],
                const SizedBox(height: 20),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    RippleButton(
                      onTap: isWorking ? null : _handleConnect,
                      isSelected: true,
                      borderRadius: BorderRadius.circular(16),
                      padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 11),
                      child: Text(
                        isWorking ? '连接中' : '连接',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF151515)),
                      ),
                    ),
                    if (isWorking) ...[
                      const SizedBox(width: 8),
                      RippleButton(
                        onTap: _handleDisconnect,
                        borderRadius: BorderRadius.circular(16),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                        child: const Text('取消', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                      ),
                    ],
                  ],
                ),
              ] else ...[
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: _p2p['transport'] == 'relay' ? const Color(0xFF0284C7) : const Color(0xFF10B981),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _p2p['transport'] == 'relay' ? '中继兜底已就绪' : 'P2P 直连已就绪',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: _p2p['transport'] == 'relay' ? const Color(0xFF0369A1) : const Color(0xFF059669),
                      ),
                    ),
                    if (pingMs != null) ...[
                      const SizedBox(width: 8),
                      Text('$pingMs ms', style: TextStyle(fontSize: 12, fontFamily: WindowService.monoFont, color: Colors.black.withOpacity(0.45))),
                    ],
                  ],
                ),
                const SizedBox(height: 16),
                SelectableText(
                  localAddress ?? '127.0.0.1:25565',
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, fontFamily: WindowService.monoFont, color: const Color(0xFF151515)),
                ),
                if (warningMsg != null && warningMsg.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    warningMsg,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFD97706)),
                  ),
                ],
                const SizedBox(height: 22),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    RippleButton(
                      onTap: () => _copy(localAddress ?? '127.0.0.1:25565'),
                      isSelected: true,
                      borderRadius: BorderRadius.circular(16),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(_copied ? CupertinoIcons.checkmark_alt : CupertinoIcons.doc_on_doc, size: 14, color: const Color(0xFF151515)),
                          const SizedBox(width: 6),
                          Text(_copied ? '已复制' : '复制地址', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF151515))),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    RippleButton(
                      onTap: _handleDisconnect,
                      borderRadius: BorderRadius.circular(16),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      child: const Text('断开', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFE11D48))),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
