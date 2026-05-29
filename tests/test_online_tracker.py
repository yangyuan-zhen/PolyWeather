import importlib
import sys
import threading


def test_online_tracker_cleanup_timer_is_daemon(monkeypatch):
    timers = []

    class FakeTimer:
        def __init__(self, interval, callback):
            self.interval = interval
            self.callback = callback
            self.daemon = False
            self.started = False
            timers.append(self)

        def start(self):
            self.started = True

    monkeypatch.setattr(threading, "Timer", FakeTimer)
    sys.modules.pop("src.utils.online_tracker", None)

    importlib.import_module("src.utils.online_tracker")

    assert timers
    assert timers[0].daemon is True
    assert timers[0].started is True
