# FastMinecraft (FM)

一站式 Minecraft 服务器管理工具，一键开服、可视化管理。

## 功能

- 一键创建/启动/停止 Minecraft 服务器
- 支持 Paper、Purpur、Fabric、Forge、NeoForge、Vanilla 等服务端
- 实时控制台日志
- 玩家管理（踢出、封禁、OP）
- Mod 管理（安装、启用/禁用、删除）
- 备份管理（创建、恢复、删除）
- 服务器设置可视化编辑（server.properties）
- 联机辅助（集成樱花映射 Sakura Frp）
- Java 环境自动检测与下载
- 跨平台桌面应用（Electron）

## 技术栈

- 前端：React + TypeScript + TailwindCSS
- 后端：Node.js + Express + SQLite
- 桌面：Electron

## 开发

```bash
# 安装依赖
npm install
cd frontend && npm install
cd ../backend && npm install
cd ../electron && npm install

# 启动后端
cd backend && node src/index.js

# 启动前端（开发模式）
cd frontend && npm run dev

# 启动 Electron（开发模式）
cd .. && npx electron electron/main.js

# 构建前端
cd frontend && npm run build
```

## 项目结构

```
FastMinecraft/
├── backend/          # Node.js 后端
│   ├── src/
│   │   ├── modules/  # 核心模块（服务器、Java、网络、监控）
│   │   ├── routes/   # API 路由
│   │   ├── websocket/# WebSocket 处理
│   │   └── database/ # SQLite 初始化
│   └── package.json
├── frontend/         # React 前端
│   ├── src/
│   │   ├── pages/    # 页面组件
│   │   ├── components/# 通用组件
│   │   └── lib/      # 工具库（API、WebSocket）
│   └── package.json
├── electron/         # Electron 桌面应用
│   ├── main.js       # 主进程
│   ├── preload.js    # 预加载脚本
│   └── package.json
├── instances/        # 服务器实例目录
├── java/             # Java 运行时目录
└── CHANGELOG.md
```

## 版本

当前版本：1.0.0-beta
