"""Compatibility facade for legacy ``web.routes`` imports.

Endpoint handlers now live under ``web.routers``. The remaining cache/history
helpers are implemented in ``web.services.city_runtime`` and re-exported here so
existing tests, monkeypatches, and transitional routers can keep importing
``web.routes`` while the backend is modularized incrementally.
"""

from web.services import city_runtime as _city_runtime

for _name in _city_runtime.__all__:
    globals()[_name] = getattr(_city_runtime, _name)

__all__ = list(_city_runtime.__all__)
