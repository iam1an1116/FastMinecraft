# Desktop UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the FastMinecraft frontend into a borderless, super-rounded, frosted-glass desktop application supporting both Host and Player roles with clean dynamic navigation.

**Architecture:** A top-level frosted glass Header orchestrates the view mode (Host vs Player). In Host mode, the primary navigation provides [Console/Back], [Market], [Network], and [Settings]. When entering a server, "Console" switches to "Back" and secondary tabs are dynamically presented. In Player mode, a dedicated minimalist screen allows joining via room code or direct address.

**Tech Stack:** React 18, TypeScript, TailwindCSS, Lucide-React, React Router DOM (HashRouter), Vite.

**Spec:** `docs/superpowers/specs/2026-11-14-desktop-ui-refactor-design.md`

## Global Constraints
- App frame corner radius: `rounded-[24px]` on the outermost desktop container.
- Header: frosted glass `backdrop-blur-xl bg-white/70`, borderless, no logo, left traffic-light safe margin (`pl-20`).
- No black/harsh border lines, no boxy card layouts, no explanatory/help paragraphs.
- Roles: 'host' | 'player' persisted in `localStorage`.

---

### Task 1: Global Styling & Outer Frame Clean Up

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Update Tailwind config and index.css**
  - Add `rounded-3xl` / `rounded-2xl` defaults, define soft surface backgrounds (`bg-neutral-50`, `bg-zinc-100/60`).
  - Strip out hard `.card` border rules and old `border-border` hard edges in `index.css`.
  - Ensure window scrollbars and body backgrounds fit the borderless aesthetic.

- [ ] **Step 2: Test & verify CSS compiles cleanly**
  - Run `cd frontend && npx vite build` to ensure tailwind builds without syntax errors.

---

### Task 2: Role Management & First-launch Onboarding Component

**Files:**
- Create: `frontend/src/components/RoleOnboarding.tsx`
- Create: `frontend/src/lib/role.ts`

- [ ] **Step 1: Implement role helper and Onboarding component**
  - `role.ts` provides `getRole()`, `setRole(role)`, `useRole()` hook or listener.
  - `RoleOnboarding.tsx` renders a centered, borderless modal with two large rounded action buttons: "我是服主" and "我是玩家".

- [ ] **Step 2: Verify type check passes**
  - Run `cd frontend && npx tsc --noEmit`.

---

### Task 3: Desktop Frosted Glass Header & Dynamic Navigation

**Files:**
- Create: `frontend/src/components/DesktopHeader.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Create DesktopHeader with dynamic Return/Console state**
  - Left: `pl-20` for macOS traffic lights, no logo.
  - Middle: Navigation links `[控制台/返回]` (transforms to `← 返回` when `serverId` is present in path), `[市场]`, `[联机]`, `[设置]`.
  - Sub-navigation: When viewing a specific server, show secondary tabs: `[控制台]`, `[玩家]`, `[Mod]`, `[备份]`, `[配置]`.
  - Right: Role pill toggle `[ 服主 / 玩家 ]`.
  - Styling: `backdrop-blur-xl bg-white/70`, borderless, `-webkit-app-region: drag` with `no-drag` on interactives.

- [ ] **Step 2: Update Layout container to wrap children with outer rounded-[24px] frame**

---

### Task 4: Server Overview & Server List Component

**Files:**
- Create: `frontend/src/pages/ServersOverview.tsx`

- [ ] **Step 1: Implement ServersOverview**
  - Shows server list in a modern, borderless layout (fluid grid or clean rows).
  - One-click Start/Stop, Status pill indicator (running, stopped, starting).
  - Clicking a server navigates to `/server/:id`.
  - Clean "新建服务器" button that navigates to `/market` or triggers creation.

---

### Task 5: Market (市场) Page for Deploying Server Jars

**Files:**
- Create: `frontend/src/pages/MarketPage.tsx`

- [ ] **Step 1: Implement MarketPage**
  - Tab 1: 官方核心下载 (Paper, Purpur, Fabric, Forge, NeoForge, Vanilla) with version picker and one-click "部署并开服".
  - Tab 2: 自定义服务端上传 (Upload local `.jar` and create instance).
  - Clean, borderless rounded aesthetic, zero explanatory text.

---

### Task 6: Network (联机) Page Overhaul (LAN / IPv6 / P2P)

**Files:**
- Modify: `frontend/src/pages/NetworkPage.tsx`

- [ ] **Step 1: Refactor NetworkPage to support the 3 modes**
  - Top tab/segmented toggle: `本地局域网 (LAN)` | `公网 IPv6` | `P2P 隧道`.
  - Mode 1 LAN: Detect and display local LAN IP + port with one-click copy.
  - Mode 2 IPv6: Detect and display public IPv6 address (`[240x:...]:25565`) with one-click copy.
  - Mode 3 P2P: P2P room toggle, generates room code (e.g. `FM-8892`), shows connection state.

---

### Task 7: Player Mode View (玩家模式)

**Files:**
- Create: `frontend/src/pages/PlayerModePage.tsx`

- [ ] **Step 1: Implement PlayerModePage**
  - Minimalist centered UI.
  - Input field for P2P Room Code + "加入联机" button.
  - Status display: "未连接" / "已连接至本地 127.0.0.1:25565" with Ping indicator.
  - Secondary quick links: "IPv6 直连" and "局域网自动发现".

---

### Task 8: Routing Wiring & Build Verification

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update Routes in App.tsx**
  - Role-aware routing: if player mode, render `PlayerModePage`.
  - If host mode:
    - `/` -> `ServersOverview`
    - `/server/:id` -> `ServerConsole`
    - `/server/:id/players` -> `PlayerManager`
    - `/server/:id/mods` -> `ModStore`
    - `/server/:id/backup` -> `BackupManager`
    - `/server/:id/settings` -> `ServerSettings`
    - `/market` -> `MarketPage`
    - `/network` -> `NetworkPage`
    - `/settings` -> `Settings`
- [ ] **Step 2: Run full TypeScript and Vite build**
  - Verify zero errors: `npm run build` in `frontend/`.
