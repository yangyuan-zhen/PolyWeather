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

