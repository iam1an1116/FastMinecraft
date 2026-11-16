import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/window_service.dart';
import '../widgets/ripple_button.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  List<dynamic> _runtimes = [];
  bool _scanning = false;
  int? _downloadingVersion;
  int _downloadPercent = 0;
  Timer? _progressTimer;

  @override
  void initState() {
    super.initState();
    _loadJava();
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadJava() async {
    final list = await ApiService.getJavaRuntimes();
    if (mounted) setState(() => _runtimes = list);
  }

  Future<void> _scanJava() async {
    setState(() => _scanning = true);
    await ApiService.scanJava();
    await _loadJava();
    if (mounted) setState(() => _scanning = false);
  }

  Future<void> _downloadJava(int ver) async {
    setState(() {
      _downloadingVersion = ver;
      _downloadPercent = 0;
    });

    _progressTimer?.cancel();
    _progressTimer = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      final p = await ApiService.getJavaDownloadProgress(ver);
      if (mounted) {
        setState(() {
          _downloadPercent = (p['percent'] is num) ? (p['percent'] as num).toInt() : 0;
        });
      }
    });

    await ApiService.downloadJava(ver);
    _progressTimer?.cancel();
    await _loadJava();
    if (mounted) {
      setState(() => _downloadingVersion = null);
    }
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
                    '设置',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFF151515), letterSpacing: -0.5),
                  ),
                  RippleButton(
                    onTap: _scanning ? null : _scanJava,
                    borderRadius: BorderRadius.circular(16),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_scanning)
                          const CupertinoActivityIndicator(radius: 6)
                        else
                          const Icon(CupertinoIcons.arrow_clockwise, size: 14, color: Color(0xFF1F1F1F)),
                        const SizedBox(width: 6),
                        const Text('扫描 Java', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF1F1F1F))),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Text('Java 环境', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45))),
                  const Spacer(),
                  for (final v in [25, 21, 17, 8]) ...[
                    const SizedBox(width: 6),
                    RippleButton(
                      onTap: _downloadingVersion != null ? null : () => _downloadJava(v),
                      isSelected: _downloadingVersion == v,
                      borderRadius: BorderRadius.circular(14),
                      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                      child: Text(
                        _downloadingVersion == v ? 'Java $v ($_downloadPercent%)' : '安装 Java $v',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF151515)),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 12),
              Expanded(
                child: _runtimes.isEmpty
                    ? Center(
                        child: Text(
                          '未检测到 Java',
                          style: TextStyle(fontSize: 13, color: Colors.black.withOpacity(0.4)),
                        ),
                      )
                    : ListView.separated(
                        itemCount: _runtimes.length,
                        separatorBuilder: (_, __) => Divider(
                          height: 1,
                          thickness: 0.5,
                          color: Colors.black.withOpacity(0.045),
                        ),
                        itemBuilder: (context, i) {
                          final r = _runtimes[i];
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 12),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Java ${r['version'] ?? ''}',
                                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: Color(0xFF151515)),
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: Text(
                                    r['path']?.toString() ?? '',
                                    textAlign: TextAlign.right,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(fontSize: 11, fontFamily: WindowService.monoFont, color: Colors.black.withOpacity(0.42)),
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
