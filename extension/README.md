# PolyWeather 侧边栏插件（MVP）

这是一个 Chrome / Edge 侧边栏扩展的 MVP，用于把 PolyWeather 右侧城市卡片移植到浏览器侧边栏中。

## 功能

- 侧边栏展示：
  - 城市选择
  - 风险徽章
  - 城市档案（结算源 / 距离 / 观测更新时间 / 周边站点）
  - 今日日内走势（简版 Canvas）
  - 多日预报（`DEB` 优先）
  - 基础判断卡（方向 / 置信度 / 原因）
- 快捷按钮：
  - 今日日内分析
  - 历史对账
  - 打开网站查看更多
- 自动识别城市：
  - 监听当前激活标签页 URL（例如 Polymarket `.../event/highest-temperature-in-ankara-...`）
  - 自动将侧边栏城市切换为 URL 对应城市
- 设置页可配置：
  - 网站基础地址
  - API 基础地址
  - Bearer Token（可选）

## 本地安装（开发者模式）

1. 打开 Chrome/Edge 扩展页面：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 打开“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择目录：`extension/`。
5. 点击扩展图标，侧边栏会打开。

## 设置

首次建议打开扩展“选项页”并确认：

- `网站基础地址`：你的前端域名（例如 `https://polyweather-pro.vercel.app`）
- `API 基础地址`：你的后端 API 域名（若同域也可填前端域名）
- `Bearer Token`：后端开启鉴权时填写

## 说明

- 当前版本仍是轻量 MVP，重点是“监控 + 基础判断 + 导流回站”，未接入支付链路。
- 若你的 API 做了严格鉴权，请先在设置页填写 token 再使用。
- 台北现在按 `NOAA RCTP` 结算参考展示。
- 插件不会承载完整分析；完整结构判断、历史对账和更多信号仍以主站为准。
