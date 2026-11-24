# Lumen

本地优先的个人 AI 对话与 EPUB 阅读工作台。前端是 iOS 质感的 PWA，后端是 Cloudflare Worker。

- **首页 / 对话 / 历史 / 设置** 四个界面，移动优先，宽屏展开侧栏
- **EPUB 上传** 后转为 Markdown，可按章提问
- **流式回答**，思考过程可折叠，Token 用量按设备统计
- **四套配色**（浅色 / 深色 / 单色 / 米色）
- 对话与设置存在本地，可选与 Worker 的 KV 同步

## 目录

```
src/
  components/     Sheet、Composer、列表行、导航栏、消息渲染
  screens/        首页、对话、历史、设置、登录、两个弹层
  state/          LumenContext：会话、模型、流式、用量
  lib/            API 客户端、本地存储、视口与主题
  styles/         Tailwind 主题与设计令牌
worker/           Cloudflare Worker：API、EPUB 解析、模型供应商适配
  index.mjs       当前维护的 API 入口
base/             原生产版本的恢复快照，仅供历史参考
mock/             本地 mock API，供前端独立开发
tools/build.mjs   产出 built/（Worker bundle + 静态资源）
public/           PWA 图标、manifest、service worker
```

## 本地开发

```bash
npm install
node mock/server.mjs &   # mock API，监听 8787
npm run dev              # http://localhost:4173
```

登录令牌是 `local-test-only`（见 `mock/server.mjs` 顶部的 `MOCK_TOKEN`）。`vite.config.ts` 把 `/api` 代理到 8787。

## 类型与构建

```bash
npm run typecheck        # tsc --noEmit
npm test                 # 对话流、供应商协议、EPUB 与存储恢复回归
npm run build            # 前端 → dist/
node tools/build.mjs     # 完整产物 → built/worker.mjs + built/public/
```

## 部署到 Cloudflare

```bash
node tools/build.mjs
cp wrangler.example.jsonc wrangler.jsonc   # 填入 Worker 名称与 KV namespace ID
npx wrangler secret put APP_ACCESS_TOKEN
npx wrangler secret put OPENCODE_GO_API_KEY
npx wrangler deploy
```

`worker/index.mjs` 已纳入版本管理，直接构建即可。`tools/patch-worker.py` 是历史恢复工具，重新运行会覆盖当前 API 修复，不用于日常部署。

示例配置启用了 `enable_request_signal`，使停止生成与客户端断开能够取消上游请求；部署时请保留该兼容标志。

## 设计约定

- **设计令牌全部在 `src/styles/app.css` 的 `@theme` 里**。组件不写死颜色，深色模式靠覆盖令牌而不是 `dark:` 变体。
- **应用背景贴齐视口边缘**。页框高度取自 `--app-height`（视觉视口），键盘弹出时页框只收缩一次。阅读内容在宽屏上保持适合阅读的行宽。
- **玻璃层用 `--glass-*`**。导航栏是 `absolute` 覆盖在滚动区之上——如果用 `sticky` 作为 flex 兄弟节点，滚动区会从它下方开始，`backdrop-filter` 就没有内容可模糊。
- **安全区只在 `.app-frame` 上计算一次**，面板内部不再叠加。
- **弹层**基于原生 `<dialog>` + `showModal()`，焦点陷阱、ESC、遮罩交给浏览器。
- **本地存储的键名是兼容契约**（见 `src/lib/store.ts` 顶部注释），改动会导致历史对话丢失。

## 截图

`node tools/shoot.mjs /tmp/shots` 用本机 Chrome 通过 CDP 截取各界面，需要 `CHROME` 环境变量指向 Chrome 可执行文件。
