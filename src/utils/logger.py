import sys
from loguru import logger

def setup_logger(level="DEBUG"):
    """
    Configure loguru logger
    """
    logger.remove()  # Remove default handler
    
    # 控制台输出 - 使用支持中文的格式
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
        level=level
    )
    
    # 文件输出
    logger.add(
        "data/logs/trading_system.log",
        rotation="10 MB",
        retention="10 days",
        level=level,
        encoding="utf-8",
        compression="zip"
    )

    logger.info("日志系统初始化完成。")
