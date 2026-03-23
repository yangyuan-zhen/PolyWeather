import math
from typing import Optional, Union


Number = Union[int, float]


def wu_round(value: Optional[Number]) -> Optional[int]:
    """
    WU 结算口径四舍五入（0.5 一律进位）:
    - 正数: floor(x + 0.5)
    - 负数: ceil(x - 0.5)
    """
    if value is None:
        return None
    x = float(value)
    if x >= 0:
        return int(math.floor(x + 0.5))
    return int(math.ceil(x - 0.5))


def is_exact_settlement_city(city: str) -> bool:
    """是否为不四舍五入的精确结算城市"""
    if not city:
        return False
    c = str(city).lower().strip()
    return c in ["hong kong", "hk", "香港"]


def apply_city_settlement(city: str, value: Optional[Number]) -> Optional[int]:
    """
    根据城市返回最终的结算值：
    - 香港/台北: 向下取整 (e.g. 28.9 -> 28)
    - 其他: WU 规则四舍五入
    """
    if value is None:
        return None
    if is_exact_settlement_city(city):
        return int(math.floor(float(value)))
    return wu_round(value)
