# 为 publisher.js 添加 Express 可视化网页

## 一、需求概述

为现有的 MQTT 温度发布脚本 [publisher.js](file:///c:/Users/1/Desktop/iot-demo/publisher.js) 增加一个基于 Express 的可视化网页：

- 实时看板：当前温度大卡片、最近温度折线图、发布日志。
- 发布控制：启动 / 暂停发布，在线调整发布间隔、温度随机范围。
- 运行方式：合并为一个服务（`server.js`），一个命令同时启动 MQTT 发布逻辑与网页，数据通过 SSE 实时推送到前端。

## 二、现状分析

| 项目 | 现状 |
| --- | --- |
| [publisher.js](file:///c:/Users/1/Desktop/iot-demo/publisher.js) | 单文件脚本，直连 `mqtt://127.0.0.1:1883`，连上后每 3 秒向 `iot/demo/temperature` 发布 `{"temperature":25~30}`；无法被复用或控制 |
| [package.json](file:///c:/Users/1/Desktop/iot-demo/package.json) | **JSON 语法错误**：`"sub"` 行末尾缺逗号，`npm install` 会失败；已声明 `pub` 脚本；未安装 express |
| `.env` | 已有 `MQTT_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` / `TOPIC`，但 publisher.js 未读取 |
| node_modules | 已安装 mqtt、dotenv，**未安装 express** |
| 目录结构 | 无 `public/`、无 `server.js`、无 `subscriber.js`（`sub` 脚本指向不存在的文件，本次不处理） |

Node v24 / npm 11，CommonJS（`"type": "commonjs"`）。

## 三、改造方案

### 1. 修改 `package.json`

- 修复 `scripts` 的 JSON 语法错误（补逗号）。
- 新增依赖 `express`（按要求使用 Express 框架）。
- 新增脚本：
  - `"start": "node server.js"` —— 启动看板服务；
  - 保留 `"pub": "node publisher.js"` —— 纯脚本模式仍然可用。

### 2. 重构 `publisher.js` 为可复用模块（保留命令行用法）

改造为「工厂函数 + 事件」结构，供 server.js 复用，同时保持 `node publisher.js` 行为不变：

```js
createPublisher({ url, topic, username, password, intervalMs, min, max })
```

返回对象能力：

- `connect()` / `start()` / `stop()` / `publishOnce()` / `updateConfig({ intervalMs, min, max })`；
- 只读状态：`connected`、`running`、`config`；
- 事件：`status`（连接状态变化）、`published`（`{ temperature, ts }`）、`log`（`{ level, message, ts }`）、`error`。
- 随机温度 = `min + Math.random() * (max - min)`，保留 2 位小数，JSON 载荷格式保持 `{"temperature":xx.xx}`，Topic 不变。
- 内部逻辑：
  - 使用 `dotenv` 读取 `MQTT_URL` / `TOPIC` / 用户名密码，缺省回退 `mqtt://127.0.0.1:1883`、`iot/demo/temperature`；
  - 定时器仅在有连接时生效；`stop()` 清除定时器；
  - `updateConfig` 校验后生效，若正在运行则按新间隔重建定时器。
- 文件末尾保留 `if (require.main === module)` 分支：以原脚本方式启动、打印「连上 Broker / 已发布温度」，保证现有 `npm run pub` 用法不变。

### 3. 新增 `server.js`（Express 服务）

- 读取 `.env`（`PORT` 缺省 `3000`，并沿用 MQTT 配置）。
- `express.json()`、`express.static('public')`。
- 服务启动时即调用 `publisher.connect()`，默认**不自动开始发布**（由页面按钮控制）；页面需要时点击「开始发布」。
- 维护内存态：最新一条读数、最近 60 条历史（约 3 分钟）、最近 50 条日志、连接/运行状态。
- 路由：
  | 方法 & 路径 | 说明 |
  | --- | --- |
  | `GET /api/state` | 返回 `{ connected, running, config, latest, history, logs }` |
  | `GET /api/stream` | SSE，连接时先推 `state`，之后推送 `reading` / `log` / `status` / `config` 事件 |
  | `POST /api/start` | 开始定时发布；Broker 未连接时返回 503 与提示 |
  | `POST /api/stop` | 停止定时发布 |
  | `POST /api/config` | 更新 `intervalMs / min / max`，做范围校验（间隔 500–60000ms，温度 -50–100，`min < max`），非法返回 400 |
- 全局错误处理与 `process.on('uncaughtException')` 仅做日志，不引入额外复杂度。

### 4. 新增前端页面（`public/`）

无构建步骤、无 CDN 依赖（离线可用），原生 HTML/CSS/JS：

- `public/index.html`：
  - 顶部标题 + 连接状态徽标 + 「开始/暂停发布」按钮；
  - 主区域：当前温度大数字卡片（显示 ℃、时间戳）、统计信息（本次会话发布条数、平均值、最大/最小值）；
  - 中部：Canvas 折线图（最近 60 点，含网格/渐变填充/最新点高亮）；
  - 侧边/底部：控制面板（发布间隔滑块或数字输入、温度 min/max 输入、「应用」按钮）+ 滚动日志列表。
- `public/style.css`：深色科技风仪表盘，CSS 变量统一配色，响应式（窄屏单列）。
- `public/app.js`：
  - `EventSource('/api/stream')` 订阅 `reading` / `log` / `status` / `config`；
  - 收到读数后更新卡片、统计、重绘 Canvas；
  - 按钮调用对应 `fetch` 接口，失败时在日志区提示；
  - 页面加载先 `GET /api/state` 补齐历史。

### 5. 配置

- `.env` 追加 `PORT=3000`。

## 四、假设与决策

1. 采用用户确认的「合并为一个服务 + 看板与发布控制」方案，不另起订阅进程。
2. 页面不提供手动单条发布（用户未选择该选项）。
3. SSE 而非 WebSocket：单向数据流、实现简单、浏览器原生支持（`ws` 包虽存在但不使用）。
4. 图表手写 Canvas，避免引入 Chart.js 等额外前端依赖，保证无网环境可运行。
5. `publisher.js` 保持 CommonJS，不迁移 ESM。
6. 不修改 `sub` 脚本指向的缺失 `subscriber.js`（超出本次范围）。

## 五、实施步骤

1. 修复 `package.json` 语法错误，添加 `express` 依赖与 `start` 脚本。
2. 执行 `npm install express`。
3. 重构 `publisher.js` 为模块 + CLI 双模式。
4. 新建 `server.js`（Express + SSE + 控制接口）。
5. 新建 `public/index.html`、`public/style.css`、`public/app.js`。
6. 在 `.env` 增加 `PORT=3000`。

## 六、验证

1. `node -e "require('./package.json')"` 确认 package.json 合法；`node -c` 等价检查（`node --check server.js publisher.js public/app.js`）语法通过。
2. 后台启动 `npm start`，确认监听 3000 端口、`GET /api/state` 返回 JSON。
3. 浏览器打开 `http://localhost:3000`：
   - 页面正常渲染，连接状态随 Broker 是否可用来回切换（本机无 Broker 时显示「未连接」且「开始发布」提示失败，属预期）；
   - 修改间隔 / 温度范围并「应用」，配置成功回写；
   - 若有本地 MQTT Broker：点击「开始发布」后曲线与日志持续更新，暂停后停止。
4. `node publisher.js` 仍能按原方式运行（无 Broker 时打印错误而不崩溃）。
