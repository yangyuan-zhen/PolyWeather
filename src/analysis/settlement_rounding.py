from typing import Optional, Union


Number = Union[int, float]


def apply_city_settlement(city: str, value: Optional[Number]) -> Optional[int]:
    if value is None:
        return None
    return int(round(float(value)))
