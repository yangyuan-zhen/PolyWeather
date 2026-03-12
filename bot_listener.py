import os
import sys

# 确保项目根目录在 sys.path 中
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.bot.orchestrator import start_bot  # noqa: E402


if __name__ == "__main__":
    start_bot()
