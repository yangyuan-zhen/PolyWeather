import threading
import time
import sys
import subprocess
import os
from loguru import logger

def run_monitor():
    """启动监控引擎模块 (main.py)"""
    logger.info("📡 正在启动后台监控引擎 (主动预警模式)...")
    cmd = [sys.executable, "main.py"]
    subprocess.run(cmd)

def run_bot():
    """启动电报交互模块 (bot_listener.py)"""
    logger.info("🤖 正在启动电报指令监听器 (被动查询模式)...")
    cmd = [sys.executable, "bot_listener.py"]
    subprocess.run(cmd)

def main():
    logger.info("🌟 PolyWeather 全功能系统正在初始化...")
    
    # 创建共享文件夹 (如果不存在)
    if not os.path.exists("data"):
        os.makedirs("data")

    # 创建两个线程并行运行
    monitor_thread = threading.Thread(target=run_monitor, daemon=True)
    bot_thread = threading.Thread(target=run_bot, daemon=True)

    # 启动线程
    monitor_thread.start()
    bot_thread.start()

    logger.success("🚀 系统已全面上线！")
    logger.info("您可以现在去电报发送 /signal 指令测试。")
    logger.info("监控引擎将在后台持续运行，发现 85¢-95¢ 价格将自动推送。")

    try:
        # 保持主进程运行
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.warning("停止运行...")

if __name__ == "__main__":
    main()
