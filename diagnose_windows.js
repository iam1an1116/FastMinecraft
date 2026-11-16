/**
 * FastMinecraft 樱花映射 Windows 诊断脚本
 *
 * 用法：在 Windows 上，cd 到 FastMinecraft 目录，运行：
 *   node diagnose_windows.js
 *
 * 把完整输出复制贴给开发者即可。
 */
const { execSync, spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const https = require('https');
const http = require('http');

const LINE = '='.repeat(60);

function run(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, windowsHide: true }).trim();
  } catch (e) {
    return `(失败: ${e.message.slice(0, 80)})`;
  }
}

function runSilent(cmd) {
  try { execSync(cmd, { encoding: 'utf-8', timeout: 8000, windowsHide: true }); return 'OK'; }
  catch { return '(失败)'; }
}

function checkProcess(name) {
  const result = run(`tasklist /FI "IMAGENAME eq ${name}" /NH 2>nul`);
  return result.includes(name);
}

function safeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request({
      hostname: urlObj.hostname, port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log(LINE);
  console.log('FastMinecraft 樱花映射诊断 (Windows)');
  console.log(LINE);

  // ── 1. 进程检查 ──
  console.log('\n[1] 进程状态');
  console.log(`  SakuraLauncher.exe  : ${checkProcess('SakuraLauncher.exe') ? '运行中' : '未运行'}`);
  console.log(`  natfrp-service.exe  : ${checkProcess('natfrp-service.exe') ? '运行中' : '未运行'}`);
  console.log(`  frpc.exe            : ${checkProcess('frpc.exe') ? '运行中' : '未运行'}`);

  // ── 2. 路径检测 ──
  console.log('\n[2] 路径检测');
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
  const searchBases = [
    join(process.env.LOCALAPPDATA || '', 'SakuraLauncher'),
    join(process.env.APPDATA || '', 'SakuraLauncher'),
    join(process.env.PROGRAMFILES || '', 'SakuraLauncher'),
    join(process.env['ProgramFiles(x86)'] || '', 'SakuraLauncher'),
    join(userProfile, 'SakuraLauncher'),
    join(userProfile, 'Desktop', 'SakuraLauncher'),
    join(userProfile, 'Downloads', 'SakuraLauncher'),
    'C:\\SakuraLauncher', 'D:\\SakuraLauncher', 'E:\\SakuraLauncher',
  ];

  let frpcPath = null;
  let configPath = null;

  for (const base of searchBases) {
    if (!existsSync(base)) continue;
    console.log(`  发现目录: ${base}`);
    if (!frpcPath) {
      for (const sub of ['frpc\\frpc.exe', 'bin\\frpc.exe', 'frpc.exe']) {
        const p = join(base, sub);
        if (existsSync(p)) { frpcPath = p; console.log(`    -> frpc: ${p}`); break; }
      }
    }
    if (!configPath) {
      for (const sub of ['config.json', 'data\\config.json', 'natfrp-service\\config.json']) {
        const p = join(base, sub);
        if (existsSync(p)) { configPath = p; console.log(`    -> config: ${p}`); break; }
      }
    }
  }

  // 独立 natfrp-service 配置
  if (!configPath) {
    for (const p of [
      join(process.env.LOCALAPPDATA || '', 'natfrp-service', 'config.json'),
      join(process.env.APPDATA || '', 'natfrp-service', 'config.json'),
    ]) {
      if (existsSync(p)) { configPath = p; console.log(`    -> config (独立): ${p}`); break; }
    }
  }

  // PATH 搜索
  if (!frpcPath) {
    const where = run('where frpc.exe 2>nul');
    if (where && !where.startsWith('(失败') && existsSync(where.split('\n')[0].trim())) {
      frpcPath = where.split('\n')[0].trim();
      console.log(`    -> frpc (PATH): ${frpcPath}`);
    }
  }

  console.log(`\n  最终: frpc=${frpcPath || '未找到'}`);
  console.log(`  最终: config=${configPath || '未找到'}`);

  // ── 3. 配置文件内容 ──
  console.log('\n[3] 配置文件内容');
  if (configPath && existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      console.log(`  auto_start_tunnels: ${JSON.stringify(config.auto_start_tunnels)}`);
      console.log(`  token 存在: ${!!config.token}`);
      console.log(`  user 存在: ${!!config.user}`);
      if (config.token) console.log(`  token 前8位: ${String(config.token).slice(0, 8)}...`);
    } catch (e) {
      console.log(`  读取失败: ${e.message}`);
    }
  } else {
    console.log('  配置文�不存在');
  }

  // ── 4. frpc 版本 ──
  console.log('\n[4] frpc 版本');
  if (frpcPath && existsSync(frpcPath)) {
    const ver = run(`"${frpcPath}" --version`, 5000);
    console.log(`  ${ver}`);
  } else {
    console.log('  无法检测（frpc 未找到）');
  }

  // ── 5. frpc 直接启动测试 ──
  console.log('\n[5] frpc 直接 spawn 测试');
  if (frpcPath && existsSync(frpcPath)) {
    // 先取配置
    const NATFRP_API = 'https://api.natfrp.com/v4';
    // 尝试从配置文件读 token
    let token = null;
    if (configPath && existsSync(configPath)) {
      try { token = JSON.parse(readFileSync(configPath, 'utf-8')).token; } catch {}
    }

    if (!token) {
      console.log('  无法获取 token（需要 token 才能获取 frpc 配置）');
      console.log('  请在下方粘贴你的 API 访问密钥（从 natfrp.com/user/profile 获取）：');
      console.log('  (跳过此测试请直接按回车)');
    } else {
      console.log(`  使用配置中的 token: ${String(token).slice(0, 8)}...`);
      console.log('  尝试获取隧道列表...');
      try {
        // 获取隧道列表以获取一个 tunnel ID
        const listRes = await safeFetch(`${NATFRP_API}/tunnels?token=${encodeURIComponent(token)}`);
        const list = JSON.parse(listRes.body);
        console.log(`  API 返回 ${list.length || Object.keys(list).length || 0} 个隧道`);
      } catch (e) {
        console.log(`  获取隧道列表失败: ${e.message}`);
      }

      // 尝试获取 frpc 版本
      let frpcVer = '0.51.0-sakura-12.3';
      try {
        const result = execSync(`"${frpcPath}" --version`, { encoding: 'utf-8', timeout: 5000 });
        const match = result.match(/(\d+\.\d+\.\d+[^\s]*)/);
        if (match) frpcVer = match[1];
      } catch {}

      // 测试直接 spawn frpc（用 -v 参数只看版本，不做实际穿透）
      console.log(`\n  测试 spawn frpc (--version)...`);
      await new Promise((resolve) => {
        const child = spawn(frpcPath, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d.toString());
        child.stderr.on('data', d => stderr += d.toString());
        child.on('exit', code => {
          console.log(`  frpc 退出码: ${code}`);
          if (stdout.trim()) console.log(`  stdout: ${stdout.trim().slice(0, 300)}`);
          if (stderr.trim()) console.log(`  stderr: ${stderr.trim().slice(0, 300)}`);
          resolve();
        });
        child.on('error', err => {
          console.log(`  spawn 错误: ${err.message}`);
          resolve();
        });
        setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 5000);
      });
    }
  } else {
    console.log('  跳过（frpc 未找到）');
  }

  // ── 6. 网络连通性 ──
  console.log('\n[6] API 连通性');
  try {
    const res = await safeFetch('https://api.natfrp.com/v4/');
    console.log(`  api.natfrp.com : HTTP ${res.status} (${res.body.slice(0, 100)})`);
  } catch (e) {
    console.log(`  api.natfrp.com : 不可达 (${e.message.slice(0, 80)})`);
  }

  console.log('\n' + LINE);
  console.log('诊断完成。请将以上全部输出复制给开发者。');
  console.log(LINE);
}

main().catch(e => {
  console.error('诊断脚本异常:', e);
});
