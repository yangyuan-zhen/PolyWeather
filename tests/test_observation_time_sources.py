from datetime import datetime, timezone

from src.data_collection.aeroweb_sources import _aeroweb_obs_time_from_parts
from src.data_collection.cowin_sources import _cowin_obs_time_to_iso
from src.data_collection.hko_obs_sources import _hko_obs_time_to_iso
from src.data_collection.ims_sources import _ims_obs_time_to_iso
from src.data_collection.jma_amedas_sources import _jma_obs_time_from_key
from src.data_collection.knmi_sources import _knmi_obs_time_from_filename
from src.data_collection.mgm_sources import _mgm_obs_time_to_iso


def test_aeroweb_obs_time_is_utc_aware():
    assert (
        _aeroweb_obs_time_from_parts(
            27,
            1,
            0,
            now_utc=datetime(2026, 5, 27, 1, 5, tzinfo=timezone.utc),
        )
        == "2026-05-27T01:00:00Z"
    )


def test_cowin_obs_time_uses_utc_window_when_timezone_is_missing():
    assert _cowin_obs_time_to_iso("2026-05-27T01:15:00") == "2026-05-27T01:15:00Z"
    assert _cowin_obs_time_to_iso("2026-05-27T09:15:00+08:00") == "2026-05-27T01:15:00Z"


def test_hko_one_minute_obs_time_keeps_hong_kong_timezone():
    assert _hko_obs_time_to_iso("202605270858") == "2026-05-27T08:58:00+08:00"


def test_ims_obs_time_keeps_israel_timezone():
    assert _ims_obs_time_to_iso("2026-05-27 03:50:00") == "2026-05-27T03:50:00+03:00"
    assert _ims_obs_time_to_iso("2026-01-27 03:50:00") == "2026-01-27T03:50:00+02:00"


def test_jma_amedas_obs_time_keeps_japan_timezone():
    assert _jma_obs_time_from_key("20260527095800") == "2026-05-27T09:58:00+09:00"


def test_knmi_filename_obs_time_is_utc_aware():
    assert (
        _knmi_obs_time_from_filename("KMDS__OPER_P___10M_OBS_L2_202605121150.nc")
        == "2026-05-12T11:50:00Z"
    )


def test_mgm_obs_time_is_exposed_as_utc_aware():
    assert _mgm_obs_time_to_iso("2026-05-27T01:00:00.000Z") == "2026-05-27T01:00:00Z"
    assert _mgm_obs_time_to_iso("2026-05-27T04:00:00") == "2026-05-27T04:00:00+03:00"
