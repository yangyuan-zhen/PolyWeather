# 🌡️ PolyWeather: 量化天气交易与 AI 控制中枢

![Banner Placeholder: Futuristic Weather Trading System]

PolyWeather 不仅仅是一个天气查询工具，它是专为 **Polymarket/天气衍生品** 等预测市场打造的**机构级气象量化交易辅助系统**。它通过直连全球航空级别气象站 (METAR)，结合多模型动态权重融合 (DEB)、实时微气候特征工程，并由庞大的 LLaMA 70B AI 大模型剥离人工情绪，为您提供极速、客观、致命的交易信号。

---

## 🚀 核心战力矩阵 (Core Features)

### 1. 🧠 独家护城河：动态权重集合算法 (DEB - Dynamic Ensemble Blending)

传统气象机器人只会机械地计算欧洲 ECMWF 和美国 GFS 的死板平均值。PolyWeather 引入了**动态记账与回溯算法**：

- **自适应权重进化**：基于过去 7-14 天内各个模型在特定机场（如 Ankara 的 Esenboğa 机场）的Mean Absolute Error (平均绝对误差 MAE) 表现，系统在每次查询时会自动对 5 大预测模型（ECMWF, GFS, ICON, GEM, JMA）进行误差惩罚。
- **高频并发安全锁 (Thread-Safe Database)**：搭载底层内存态单例缓存机制与系统级文件并发锁 (fcntl Lock)，即使在 500 人以上的超级大群遭遇瞬间峰值查询，系统依然能保证 0 I/O 拥堵和微秒级响应。

### 2. 🤖 人工智能交易老手 (Groq AI Agent)

系统不再输出枯燥的数字或废话模版。我们将**所有复杂的动力学参数**(风向、风速矩阵、降温惯性、进位阻力) 投喂给 LLaMA 3.3 70B (通过极速 Groq 接口)：

- **🧊 强制冷静，剥离情绪**：独创强迫逻辑约束提示词，AI 会精准判断诸如“下午3点吹 15kt 偏北冷风，且辐射跌破 50W/m²”的情况，并直接宣布“已过最热时点核心区，盘口冻结”。
- **🎯 量化置信度 (Confidence Scoring)**：直接给出带有强指导意义的 1-10 满分制置信度。置信度极高意味着“立刻建仓”，置信度极低则警告系统遇到了风向或降雨的不确定性博弈。

### 3. ⏱️ 绝对实况统治力 (Zero-Cache METAR Extraction)

在 Polymarket 结算的绞肉机里，**1 分钟的延迟可能意味着 100% 的本金亏损**。

- PolyWeather 设计为每次调用均动态附加一次性戳环，强制穿透所有代理网络（CDN）的静态缓存池。
- 提取出的不仅是“当下几度”，而是精确到小数点的结算分析（包括 Wunderground X.5 四舍五入进制边界的死亡预警）。

### 4. 📈 历史大数据挖掘基建 (Data Mining Foundation)

内置 `fetch_history.py` 原生爬虫系统。

- 一键下拉全球任意城市基准点过去 3-5 年的小时级历史物理沙盒数据特征矩阵（包含湿度、长短波辐射、地表气压等 10 余个维度），最高达数十万行量级。
- 随时为下一代 XGBoost / LightGBM 的机器学习偏差校正（MOS）提供无限火力弹药。

---

## ⚡ 部署指南 (Deployment & Operations)

### 环境架构要求

- **内核驱动**: Python 3.11+ (严格遵守)
- **依赖栈**: `pip install -r requirements.txt`
- **系统挂载**: 极简配置，仅需 `.env` 文件注册您的 `TELEGRAM_BOT_TOKEN` 及 `GROQ_API_KEY` 即可召唤 AI。

### VPS 推荐一键上线 (Production)

**步骤一：构建与注册**

```bash
git clone https://github.com/yangyuan-zhen/PolyWeather.git
cd PolyWeather
pip install -r requirements.txt
cp .env.example .env  # 务必填入您的加密 API 密钥
```

**步骤二：守护进程一键装配 (Daemon Updater)**
建立自动化保活脚本，将更新、防冲突、重载集成在一条指令内：

```bash
cat > ~/update.sh << 'EOF'
#!/bin/bash
cd ~/PolyWeather
git fetch origin
git reset --hard origin/main
pkill -f run.py
pkill -f bot_listener.py
sleep 1
nohup python3 bot_listener.py > bot.log 2>&1 &
echo "✅ PolyWeather 量化终端已成功重启并搭载最新模块！"
EOF
chmod +x ~/update.sh
```

**日常战争指令 (Push & Play)：**

```bash
~/update.sh
```

> 一键抹平 Git 冲突、热冷重启及日志切割。

---

## 🕹️ Telegram 指控终端 (Command Center)

| 战术指令           | 触发动作     | 模块反馈                                                                                |
| :----------------- | :----------- | :-------------------------------------------------------------------------------------- |
| `/city [城市代码]` | **火力侦察** | 发起全维度气象扫描，返回 DEB 加权预报、实测跟踪、进位结算风险预警，及 AI 量化看盘结论。 |
| `/id`              | **身份确认** | 映射当前交战信道（Chat ID）。                                                           |
| `/help`            | **终端手册** | 拉取最新指令集。                                                                        |

### 支持的主力猎场 (Target Arenas)

从低风险高容错的中东非靶场，到高风险巨大滑点的北美绞肉机，PolyWeather 均提供了不同的机场偏误(Risk Profile)补偿模板：
`lon`(伦敦 EGLC)、`par`(巴黎 LFPG)、`ank`(安卡拉 LTAC)、`nyc`(纽约 KLGA)、`chi`(芝加哥 KORD)、`ba`(布宜诺斯艾利斯 SAEZ)... 以及更多。

> **示例射击:**
> `/city 巴黎`
> `/city london`
> `/city ba`

---

## 🏗️ 引擎架构剖析 (System Architecture)

```mermaid
graph TD
    classDef ai fill:#f9f,stroke:#333,stroke-width:2px;
    classDef core fill:#bbf,stroke:#333,stroke-width:2px;
    classDef data fill:#dfd,stroke:#333,stroke-width:1px;

    User[Telegram / 信号接收方] -->|触发扫描指令| Bot[bot_listener.py 核心调度器]:::core

    subgraph 异构数据获取层
        Bot --> Collector[WeatherDataCollector]
        Collector --> OM[Open-Meteo 归档/实时]:::data
        Collector --> MM[多模型预测集 (ECMWF...)]:::data
        Collector --> METAR[机场真实塔台日志]:::data
    end

    subgraph 模型计算与熔断层
        Collector --> DEB[DEB 动态融合加权算法]:::core
        DEB --> DB[(daily_records JSON 数据库<br/>并发安全保护)]
        Collector --> Logic[结算进位判定 / 冷却判定]
    end

    subgraph AI 量度生成层
        DEB --> AIAnalyzer[Groq/LLaMA 深度认知模型]:::ai
        Logic --> AIAnalyzer
        METAR --> AIAnalyzer
    end

    AIAnalyzer -->|生成: 盘口+逻辑+置信度| Bot
    Bot -->|组合高维信息切片| User
```

---

## 🎯 实战交易纲领 (Trader's Playbook)

作为 PolyWeather 的指挥官，请将以下准则刻入 DNA 之中：

1. 🧬 **信仰 DEB 基准线**：比起单方面相信 ECMWF 或 GFS 的某个极端值，请紧盯开头那一行 `DEB 融合预测`。因为那是系统吸收了最近几天这两个模型挨过的毒打之后，为您重新调整过的公论。
2. 🎯 **严守 AI 置信度红线**：一旦 AI 反馈 `置信度 ≤ 4/10`，代表模型数据严重滞后于实况机场风速带来的博弈冲突，立即**切断**盲目押注的手，这属于高风险混沌区。
3. ⚖️ **敬畏 X.5 结界**：Polymarket 天气盘底层以 Wunderground 取整数结算为准。当你看到终端闪烁 `⚖️ 结算边界... 刚刚越过进位线` 时，这往往是盘面上流动性抽干、盘口滑点最凶残的地方。
4. 🌙 **识破假阳性 (暖平流侦测)**：若气温在辐射低谷的夜间和清晨依然狂飙，此时系统必然触发 `🌙 暖平流动力异常`。这一机制经常会在绝大多数赌客看跌时，为您指出真正做多打穿预报上限的信号。

---

_The weather changes. Our edge remains. | 更新于 2026_
