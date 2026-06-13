from scripts.sync_forum_topics_mtproto import build_city_thread_mapping


def test_build_city_thread_mapping_normalizes_hashtag_topic_names():
    topics = [
        {"id": 101, "title": "#seoul"},
        {"id": 102, "title": "#HongKong"},
        {"id": 103, "title": "#TelAviv"},
        {"id": 104, "title": "#NewYork"},
        {"id": 105, "title": "#SanFrancisco"},
        {"id": 106, "title": "#LauFauShan"},
    ]

    mapping = build_city_thread_mapping(topics)

    assert mapping == {
        "seoul": 101,
        "hong kong": 102,
        "tel aviv": 103,
        "new york": 104,
        "san francisco": 105,
        "shenzhen": 106,
    }


def test_build_city_thread_mapping_supports_flagged_topic_titles():
    topics = [
        {"id": 201, "title": "🇰🇷 Seoul"},
        {"id": 202, "title": "🇨🇳 Shenzhen / Lau Fau Shan"},
        {"id": 203, "title": "🇺🇸 Los Angeles"},
    ]

    mapping = build_city_thread_mapping(topics)

    assert mapping == {
        "seoul": 201,
        "shenzhen": 202,
        "los angeles": 203,
    }
