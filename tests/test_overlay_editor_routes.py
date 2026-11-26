"""Phase 4's editor API: POST /scene (tagged SVG and boxes per title) and GET /libraries/{library}/samples."""

from fakeplex import FakePlex

from starr_studio.overlay_engine.facts import TitleFacts
from starr_studio.overlay_engine_routes import POSTER_HREF, pick_samples
from tests.test_overlays import make_client

DOT = (
    "studio_style: 1\nname: Dot\nelements:\n"
    '  - { type: rect, box: { left: 10, top: 20, width: 100, height: 50 }, fill: { colour: "#FFFFFF" } }\n'
    "  - type: row\n    box: { left: 0, bottom: 0 }\n    children:\n"
    "      - { type: text, text: '{imdb}', size: 40, show_when: { has: imdb } }\n"
    "      - { type: text, text: '{year}', size: 40 }\n"
)


def test_scene_tags_each_element_with_its_path_and_box(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        response = client.post("/api/v1/overlay-engine/scene", json={"library": "Movies", "rating_keys": ["4635", "8586"], "yaml": DOT})
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert [i["rating_key"] for i in items] == ["4635", "8586"]
        first = items[0]
        assert first["boxes"]["elements.0"] == [10, 20, 100, 50]
        assert "elements.1" in first["boxes"] and "elements.1.children.1" in first["boxes"]
        assert '<g data-path="elements.0">' in first["svg"] and f'href="{POSTER_HREF}"' in first["svg"]
        assert first["thumb"].startswith("/library/metadata/4635/thumb/") and first["title"]
        # a child hidden on this title keeps the others' paths: {year} is still children.1
        for item in items:
            assert "elements.1.children.1" in item["boxes"]


def test_scene_says_what_is_wrong(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        url = "/api/v1/overlay-engine/scene"
        assert client.post(url, json={"library": "Movies", "rating_keys": ["4635"], "yaml": "studio_style: 1\nname: x\n"}).status_code == 422
        assert client.post(url, json={"library": "Movies", "rating_keys": [str(n) for n in range(13)], "yaml": DOT}).status_code == 422
        assert client.post(url, json={"library": "Nope", "rating_keys": ["4635"], "yaml": DOT}).status_code == 404


def test_samples_route(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        response = client.get("/api/v1/overlay-engine/libraries/Movies/samples?count=3")
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert 1 <= len(items) <= 3
        assert all(i["thumb"].startswith(f"/library/metadata/{i['rating_key']}/thumb/") and i["traits"] for i in items)


def facts(key: str, **kw) -> TitleFacts:
    return TitleFacts(rating_key=key, type="movie", title=key, **kw)


def test_pick_samples_covers_kinds_of_title_newest_first():
    now = 1_800_000_000
    titles = [
        facts("old-1080", resolution="1080P", added_at=now - 900 * 86400),
        facts("new-1080", resolution="1080P", added_at=now - 86400),
        facts("old-4k-hdr", resolution="4K", hdr="HDR10", imdb=7.5, rt_critic=90, added_at=now - 800 * 86400),
        facts("old-1080-b", resolution="1080P", added_at=now - 700 * 86400),
    ]
    picked = [f.rating_key for f, _ in pick_samples(titles, 2, now)]
    assert picked == ["new-1080", "old-4k-hdr"]  # all add as much at first, so the newest; then the 4K one adds most
    assert len(pick_samples(titles, 12, now)) == 4
