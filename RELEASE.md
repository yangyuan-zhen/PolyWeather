# 版本发布流程

本项目采用语义化版本号：`MAJOR.MINOR.PATCH`

当前单一版本源为根目录 [VERSION](E:/web/PolyWeather/VERSION) 文件，所有对外文档与前端版本号都从这里同步。

## 版本规则

- `PATCH`：修复缺陷、文档修正、兼容性不变的小改动
- `MINOR`：新增能力、接口扩展、向后兼容的功能迭代
- `MAJOR`：不兼容变更、核心架构升级、公开接口重大调整

示例：

- `1.4.0 -> 1.4.1`：告警逻辑修正、缓存修正、文档修正
- `1.4.0 -> 1.5.0`：新增支付能力、新增页面、新增 API
- `1.4.0 -> 2.0.0`：接口重构或数据结构不兼容

## 日常升版步骤

### 1. 升版本号

```bash
python scripts/bump_version.py patch
```

可选参数：

```bash
python scripts/bump_version.py minor
python scripts/bump_version.py major
python scripts/bump_version.py 1.5.0
```

### 2. 检查同步结果

```bash
python scripts/sync_version.py
git diff
```

### 3. 补充 Changelog

在 [CHANGELOG.md](E:/web/PolyWeather/CHANGELOG.md) 对应版本下补齐：

- 新增能力
- 修复项
- 兼容性说明

### 4. 验证

建议至少执行：

```bash
cd frontend
npm run build
```

如涉及后端核心逻辑，补充执行：

```bash
python -m pytest
```

### 5. 提交与打标签

工作区干净后再打标签：

```bash
git add .
git commit -m "release: v1.4.1"
git tag v1.4.1
```

### 6. 推送

```bash
git push
git push origin v1.4.1
```

## 当前约束

- 不直接手改多份文档版本号
- 不在工作区脏状态下打 release tag
- `README.md`、前端 `package.json`、文档标题版本都通过脚本同步
