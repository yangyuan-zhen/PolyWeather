# PolyWeather Side Panel Extension (MVP)

这是一个 Chrome / Edge 的侧边栏扩展 MVP，用于把 PolyWeather 右侧城市卡片移植到浏览器侧边栏中。

## 功能

- 侧边栏展示：
  - 城市选择
  - 风险徽章
  - 城市档案（结算源/距离/观测更新/周边站点）
  - 今日日内走势（简版 Canvas）
  - 多日预报
- 快捷按钮：
  - 今日日内分析
  - 历史对账
  - 打开完整网站分析
- 自动识别城市：
  - 监听当前激活标签页 URL（例如 Polymarket `.../event/highest-temperature-in-ankara-...`）
  - 自动将侧边栏城市切换为 URL 对应城市
- 设置页可配置：
  - Site Base URL
  - API Base URL
  - Bearer Token（可选）

## 本地安装（开发者模式）

1. 打开 Chrome/Edge 扩展页面：
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. 打开“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择目录：`extension/`。
5. 点击扩展图标，侧边栏会打开。

## 设置

首次建议打开扩展“选项页”并确认：

- `Site Base URL`：你的前端域名（例如 `https://polyweather-pro.vercel.app`）
- `API Base URL`：你的后端 API 域名（若同域也可填前端域名）
- `Bearer Token`：后端开启鉴权时填写

## 说明

- 当前是 MVP，重点是“导流回站”，未接入支付链路。
- 若你的 API 做了严格鉴权，请先在设置页填 token 再使用。
