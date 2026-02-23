import subprocess
import os
import sys
from loguru import logger


def main():
    logger.info("🌡️ PolyWeather 天气查询机器人启动中...")

    # 创建数据目录
    os.makedirs("data", exist_ok=True)

    # 直接运行 bot_listener
    cmd = [sys.executable, "bot_listener.py"]
    logger.success("🚀 已上线！等待 Telegram 指令...")

    try:
        subprocess.run(cmd, cwd=os.getcwd())
    except KeyboardInterrupt:
        logger.warning("停止运行...")


if __name__ == "__main__":
    main()
