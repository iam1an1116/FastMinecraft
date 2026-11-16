import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/window_service.dart';

class MemorySlider extends StatefulWidget {
  final int valueMB;
  final ValueChanged<int> onChanged;
  final String label;

  const MemorySlider({
    super.key,
    required this.valueMB,
    required this.onChanged,
    this.label = '内存分配',
  });

  @override
  State<MemorySlider> createState() => _MemorySliderState();
}

class _MemorySliderState extends State<MemorySlider> {
  int _maxMB = 16384;

  @override
  void initState() {
    super.initState();
    _loadSystemMax();
  }

  Future<void> _loadSystemMax() async {
    final info = await ApiService.getSystemInfo();
    final maxAlloc = info['maxAllocatableMB'];
    if (mounted && maxAlloc is int && maxAlloc >= 4096) {
      setState(() => _maxMB = maxAlloc);
    }
  }

  @override
  Widget build(BuildContext context) {
    const int minMB = 2048;
    final int effectiveMax = _maxMB < 4096 ? 4096 : _maxMB;
    final double clamped = widget.valueMB.clamp(minMB, effectiveMax).toDouble();
    final int divisions = ((effectiveMax - minMB) / 512).round().clamp(1, 128);
    final String currentGb = (clamped / 1024).toStringAsFixed(clamped % 1024 == 0 ? 0 : 1);
    final String maxGb = (effectiveMax / 1024).toStringAsFixed(effectiveMax % 1024 == 0 ? 0 : 1);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              widget.label,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.black.withOpacity(0.45)),
            ),
            Text(
              '${currentGb}G (${clamped.round()}MB) / 上限 ${maxGb}G',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                fontFamily: WindowService.monoFont,
                color: const Color(0xFF151515),
              ),
            ),
          ],
        ),
        const SizedBox(height: 2),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 4,
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
            overlayShape: const RoundSliderOverlayShape(overlayRadius: 13),
            activeTrackColor: const Color(0xFF333333),
            inactiveTrackColor: Colors.black.withOpacity(0.08),
            thumbColor: const Color(0xFF1F1F1F),
            overlayColor: Colors.black.withOpacity(0.06),
          ),
          child: Slider(
            value: clamped,
            min: minMB.toDouble(),
            max: effectiveMax.toDouble(),
            divisions: divisions,
            onChanged: (v) {
              final snapped = ((v / 512).round() * 512).clamp(minMB, effectiveMax);
              widget.onChanged(snapped);
            },
          ),
        ),
      ],
    );
  }
}
