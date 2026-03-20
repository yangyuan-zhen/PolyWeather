"""
PolyWeather Web Map API
~~~~~~~~~~~~~~~~~~~~~~~
FastAPI backend that reuses existing weather data collection and analysis modules.
Serves a Leaflet-based interactive map frontend.
"""

import os
import sys

_file_dir = os.path.dirname(os.path.abspath(__file__))
_root = os.path.dirname(_file_dir)
if _root not in sys.path:
    sys.path.insert(0, _root)
if _file_dir not in sys.path:
    sys.path.insert(0, _file_dir)

from web.analysis_service import (  # noqa: E402
    _analyze,
    _build_city_detail_payload,
    _build_city_summary_payload,
)
from web.core import app  # noqa: E402
from web.routes import router  # noqa: E402

app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
