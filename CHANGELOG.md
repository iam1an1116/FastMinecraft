# Changelog

## [1.0.0-beta2] - 2026-06-26

### 修复

- 自定义路径服务器创建后下载 jar 到错误目录
- 自定义 Java 路径重启后丢失，改为数据库持久化
- 下载进度回调在无 Content-Length 时除零
- 后端重启后旧隧道阻塞新隧道创建（自动清理僵尸隧道）
- SSL 证书验证失败导致樱花 API 无法访问
- 服务器卡在「启动中」无法恢复，新增强制停止功能

### 新增

- 服务器强制停止按钮（侧边栏 + 控制台）
- 全局设置页面 Java 路径持久化

## [1.0.0-beta] - 2026-06-26

### 新增

#### 核心功能
- 一键创建 Minecraft 服务器，支持 Paper、Purpur、Fabric、Forge、NeoForge、Vanilla
- 服务器启动/停止/重启
- 实时控制台日志（WebSocket）
- 服务器自动重启（崩溃检测）

#### 管理功能
- 玩家管理：踢出、封禁、OP
- Mod 管理：上传、启用/禁用、删除
- 备份管理：创建、恢复、删除
- 服务器设置：可视化编辑 server.properties（正版验证、视距、难度、游戏模式等）

#### 联机功能
- 集成樱花映射（Sakura Frp）
- 自动检测本地 SakuraLauncher 安装
- 支持手动指定 frpc 路径
- 节点选择、隧道创建/删除

#### Java 环境
- 自动检测本地 Java 安装（macOS / Windows）
- 自动下载 Java（Adoptium Temurin）
- 支持 Java 8、17、21

#### 桌面应用
- Electron 桌面应用（macOS / Windows）
- 自定义应用图标
- 可拖动标题栏
- 自适应窗口大小

#### 界面
- 白色极简主题
- Plus Jakarta Sans 字体
- 响应式布局
- 服务器 IP 地址显示

### 技术细节

- 前端：React 18 + TypeScript + Vite + TailwindCSS
- 后端：Node.js + Express + sql.js
- 桌面：Electron 28
- 实时通信：WebSocket
- 数据库：SQLite
