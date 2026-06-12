from types import SimpleNamespace

from src.bot.handlers.basic import BasicCommandHandler
from src.bot.runtime_coordinator import RuntimeStatus


class DummyBot:
    def __init__(self):
        self.replies = []
        self.sent_messages = []
        self.approved_join_requests = []
        self.declined_join_requests = []
        self.callback_handlers = []

    def reply_to(self, message, text, parse_mode=None, disable_web_page_preview=None, **kwargs):
        self.replies.append(
            {
                "text": text,
                "parse_mode": parse_mode,
                "chat_id": message.chat.id,
                "disable_web_page_preview": disable_web_page_preview,
                "reply_markup": kwargs.get("reply_markup"),
            }
        )

    def send_message(
        self,
        chat_id,
        text,
        parse_mode=None,
        disable_web_page_preview=None,
    ):  # pragma: no cover
        self.sent_messages.append(
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": disable_web_page_preview,
            }
        )

    def message_handler(self, *args, **kwargs):  # pragma: no cover - decorator stub
        def _decorator(func):
            return func

        return _decorator

    def chat_join_request_handler(self, *args, **kwargs):  # pragma: no cover - decorator stub
        def _decorator(func):
            self.join_request_handler = func
            return func

        return _decorator

    def callback_query_handler(self, *args, **kwargs):  # pragma: no cover - decorator stub
        def _decorator(func):
            self.callback_handlers.append((kwargs.get("func"), func))
            return func

        return _decorator

    def approve_chat_join_request(self, chat_id, user_id):
        self.approved_join_requests.append({"chat_id": chat_id, "user_id": user_id})

    def decline_chat_join_request(self, chat_id, user_id):
        self.declined_join_requests.append({"chat_id": chat_id, "user_id": user_id})


def _message(text: str):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=1, username="u", first_name="U"),
        chat=SimpleNamespace(id=100, type="private"),
    )


def test_basic_handler_diag_returns_html():
    runtime = RuntimeStatus(
        started_at="2026-03-12 00:00:00 UTC",
        loops=[],
        command_access_mode="group_member",
        protected_commands=[],
        required_group_chat_id="-1001234567890",
    )
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: runtime,
    )

    handler.handle_diag(_message("/diag"))

    assert len(bot.replies) == 1
    assert bot.replies[0]["parse_mode"] == "HTML"
    assert "Bot 启动诊断" in bot.replies[0]["text"]


def test_start_bind_token_binds_telegram_to_web_account():
    bot = DummyBot()
    consumed = []
    bound = []

    def _consume(token):
        consumed.append(token)
        return {
            "supabase_user_id": "user-1",
            "supabase_email": "u@example.com",
        }

    db = SimpleNamespace(
        consume_web_bind_token=_consume,
        upsert_user=lambda *_args, **_kwargs: None,
        bind_supabase_identity=lambda **kwargs: bound.append(kwargs)
        or {"ok": True, "reason": "bound"},
    )
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        display_name=lambda user: user.username,
        db=db,
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-1001234567890",
        ),
    )

    handler.handle_start_help(_message("/start bind_abc123"))

    assert consumed == ["abc123"]
    assert bound[0]["telegram_id"] == 1
    assert bound[0]["supabase_user_id"] == "user-1"
    assert len(bot.replies) == 1
    assert "账号绑定完成" in bot.replies[0]["text"]


def test_confirm_bind_callback_consumes_token_and_binds_account():
    bot = DummyBot()
    consumed = []
    bound = []

    def _consume(token):
        consumed.append(token)
        return {"supabase_user_id": "user-1", "supabase_email": "u@example.com"}

    db = SimpleNamespace(
        consume_web_bind_token=_consume,
        upsert_user=lambda *_args, **_kwargs: None,
        bind_supabase_identity=lambda **kwargs: bound.append(kwargs)
        or {"ok": True, "reason": "bound"},
    )
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        display_name=lambda user: user.username,
        db=db,
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-1001234567890",
        ),
    )
    call = SimpleNamespace(
        data="confirm_bind:abc123",
        from_user=SimpleNamespace(id=12345, username="ada", first_name="Ada"),
        message=_message("callback"),
    )

    result = handler.handle_bind_confirm_callback(call)

    assert result == "bound"
    assert consumed == ["abc123"]
    assert bound[0]["telegram_id"] == 12345
    assert bound[0]["supabase_user_id"] == "user-1"


def test_private_text_fallback_replies_with_binding_help():
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-1001234567890",
        ),
    )

    result = handler.handle_private_text_fallback(_message("@polyyuanbot"))

    assert result == "replied"
    assert len(bot.replies) == 1
    assert "/start bind_" in bot.replies[0]["text"]
    assert "/help" in bot.replies[0]["text"]


def test_private_text_fallback_ignores_slash_commands():
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-1001234567890",
        ),
    )

    result = handler.handle_private_text_fallback(_message("/city seoul"))

    assert result == "ignored:slash_command"
    assert bot.replies == []


def test_basic_handler_ignores_removed_markets_command():
    bot = DummyBot()
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-1001234567890",
        ),
        config={},
    )

    handler._dispatch(_message("/markets"))

    assert bot.replies == []
    assert bot.sent_messages == []


def _join_request(user_id: int = 12345, chat_id: int = -100123):
    return SimpleNamespace(
        from_user=SimpleNamespace(id=user_id, username="ada", first_name="Ada"),
        chat=SimpleNamespace(id=chat_id, title="PolyWeather Pro"),
    )


def test_join_request_auto_approves_bound_active_pro_user(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    bot = DummyBot()
    db = SimpleNamespace(
        list_supabase_user_ids_for_telegram=lambda telegram_id: ["user-1"]
        if telegram_id == 12345
        else []
    )
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        db=db,
    )
    entitlement = SimpleNamespace(
        has_active_subscription=lambda user_id, respect_requirement=False: user_id == "user-1"
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-100123",
        ),
        entitlement_service=entitlement,
    )

    result = handler.handle_chat_join_request(_join_request())

    assert result == "approved"
    assert bot.approved_join_requests == [{"chat_id": -100123, "user_id": 12345}]
    assert bot.declined_join_requests == []


def test_join_request_keeps_unbound_user_pending_by_default(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    bot = DummyBot()
    db = SimpleNamespace(list_supabase_user_ids_for_telegram=lambda telegram_id: [])
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        db=db,
    )
    entitlement = SimpleNamespace(has_active_subscription=lambda *_args, **_kwargs: False)
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-100123",
        ),
        entitlement_service=entitlement,
    )

    result = handler.handle_chat_join_request(_join_request())

    assert result == "pending:unbound"
    assert bot.approved_join_requests == []
    assert bot.declined_join_requests == []


def test_join_request_keeps_trial_user_pending(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    bot = DummyBot()
    db = SimpleNamespace(list_supabase_user_ids_for_telegram=lambda telegram_id: ["user-1"])
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        db=db,
    )
    entitlement = SimpleNamespace(
        get_latest_active_subscription=lambda user_id, respect_requirement=False: {
            "plan_code": "signup_trial_3d",
            "source": "signup_trial",
        }
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-100123",
        ),
        entitlement_service=entitlement,
    )

    result = handler.handle_chat_join_request(_join_request())

    assert result == "pending:no_active_subscription"
    assert bot.approved_join_requests == []


def test_join_request_approves_trial_user_with_queued_paid_subscription(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    bot = DummyBot()
    db = SimpleNamespace(list_supabase_user_ids_for_telegram=lambda telegram_id: ["user-1"])
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        db=db,
    )
    entitlement = SimpleNamespace(
        get_subscription_window=lambda user_id, respect_requirement=False: {
            "rows": [
                {"plan_code": "signup_trial_3d", "source": "signup_trial"},
                {"plan_code": "pro_monthly", "source": "payment_contract"},
            ]
        },
        get_latest_active_subscription=lambda user_id, respect_requirement=False: {
            "plan_code": "signup_trial_3d",
            "source": "signup_trial",
        },
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-100123",
        ),
        entitlement_service=entitlement,
    )

    result = handler.handle_chat_join_request(_join_request())

    assert result == "approved"
    assert bot.approved_join_requests == [{"chat_id": -100123, "user_id": 12345}]


def test_join_request_uses_subscription_window_without_latest_fallback(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    bot = DummyBot()
    db = SimpleNamespace(list_supabase_user_ids_for_telegram=lambda telegram_id: ["user-1"])
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        db=db,
    )

    def _fail_latest(*_args, **_kwargs):
        raise AssertionError("subscription window rows should avoid latest subscription fallback")

    entitlement = SimpleNamespace(
        get_subscription_window=lambda user_id, respect_requirement=False: {
            "rows": [
                {"plan_code": "signup_trial_3d", "source": "signup_trial"},
            ]
        },
        get_latest_active_subscription=_fail_latest,
    )
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-100123",
        ),
        entitlement_service=entitlement,
    )

    result = handler.handle_chat_join_request(_join_request())

    assert result == "pending:no_active_subscription"
    assert bot.approved_join_requests == []


def test_join_request_can_decline_ineligible_user_when_configured(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_GROUP_ID", "-100123")
    monkeypatch.setenv("POLYWEATHER_TELEGRAM_JOIN_INELIGIBLE_ACTION", "decline")
    bot = DummyBot()
    db = SimpleNamespace(list_supabase_user_ids_for_telegram=lambda telegram_id: ["user-1"])
    io_layer = SimpleNamespace(
        build_welcome_text=lambda: "WELCOME",
        build_points_rank_text=lambda _user: "TOP",
        db=db,
    )
    entitlement = SimpleNamespace(has_active_subscription=lambda *_args, **_kwargs: False)
    handler = BasicCommandHandler(
        bot=bot,
        io_layer=io_layer,
        runtime_status_provider=lambda: RuntimeStatus(
            started_at="2026-03-12 00:00:00 UTC",
            loops=[],
            command_access_mode="group_member",
            protected_commands=[],
            required_group_chat_id="-100123",
        ),
        entitlement_service=entitlement,
    )

    result = handler.handle_chat_join_request(_join_request())

    assert result == "declined:no_active_subscription"
    assert bot.approved_join_requests == []
    assert bot.declined_join_requests == [{"chat_id": -100123, "user_id": 12345}]
