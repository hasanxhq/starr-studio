"""Style files (shipped and the user's), the JSON Schema, and each library's chosen style (overlay engine Phase 3)."""

import json

from fakeplex import FakePlex

from starr_studio.overlay_engine.styles_store import SCHEMA_FILE, style_schema
from tests.test_overlays import make_client

API = "/api/v1/overlay-engine"
MINIMAL = "studio_style: 1\nname: Mine\noptions:\n  dark: { type: percent, default: 50, label: Dark }\nelements:\n  - { type: rect, box: { left: 0, right: 0, bottom: 0, height: 100 }, fill: { colour: '#000000', opacity: $dark } }\n"


def test_committed_schema_matches_the_models():
    assert json.loads(SCHEMA_FILE.read_text()) == style_schema(), "run scripts/make_style_schema.py"


def test_list_get_save_duplicate_delete(tmp_path):
    client, config = make_client(tmp_path)
    user_dir = config / "studio" / "styles"
    with client:
        listed = client.get(f"{API}/styles").json()
        assert [s["id"] for s in listed] == ["modern-streaming"]
        assert listed[0]["shipped"] and "accent" in listed[0]["options"]
        assert client.get(f"{API}/style-schema").json()["properties"]["studio_style"]["const"] == 1

        # shipped styles are read-only
        assert client.put(f"{API}/styles/modern-streaming", json={"yaml": MINIMAL}).status_code == 409
        assert client.delete(f"{API}/styles/modern-streaming").status_code == 409

        # a bad file is never saved
        response = client.put(f"{API}/styles/mine", json={"yaml": "studio_style: 1\nname: Mine\nelements: []\n"})
        assert response.status_code == 422 and not (user_dir / "mine.yml").exists()
        assert client.put(f"{API}/styles/Bad.Name", json={"yaml": MINIMAL}).status_code == 422

        saved = client.put(f"{API}/styles/mine", json={"yaml": MINIMAL}).json()
        assert saved["name"] == "Mine" and not saved["shipped"]
        assert (user_dir / "mine.yml").read_text() == MINIMAL
        assert client.get(f"{API}/styles/mine").json()["yaml"] == MINIMAL

        copy = client.post(f"{API}/styles/modern-streaming/duplicate", json={}).json()
        assert copy["id"] == "modern-streaming-copy" and copy["name"] == "Modern streaming (copy)"
        assert "# Shipped with Starr Studio" in copy["yaml"]  # comments kept
        assert client.post(f"{API}/styles/modern-streaming/duplicate", json={}).json()["id"] == "modern-streaming-copy-2"
        assert client.post(f"{API}/styles/mine/duplicate", json={"id": "modern-streaming"}).status_code == 409

        # a hand-edited broken file shows with its error rather than hiding
        (user_dir / "broken.yml").write_text("name: [")
        broken = next(s for s in client.get(f"{API}/styles").json() if s["id"] == "broken")
        assert broken["error"]

        assert client.delete(f"{API}/styles/mine").status_code == 204
        assert client.get(f"{API}/styles/mine").status_code == 404


def test_library_style_saved_and_used_by_preview(tmp_path):
    fake = FakePlex()
    client, config = make_client(tmp_path, fake_plex=fake)
    with client:
        assert client.get(f"{API}/libraries/Movies/style").json() == {"style": "modern-streaming", "values": {}, "saved": False}
        assert client.get(f"{API}/libraries/Nope/style").status_code == 404
        assert client.put(f"{API}/libraries/Movies/style", json={"style": "nope"}).status_code == 404
        assert client.put(f"{API}/libraries/Movies/style", json={"style": "modern-streaming", "values": {"band": 300}}).status_code == 422

        client.put(f"{API}/styles/mine", json={"yaml": MINIMAL})
        response = client.put(f"{API}/libraries/Movies/style", json={"style": "mine", "values": {"dark": 100}})
        assert response.json() == {"style": "mine", "values": {"dark": 100}, "saved": True}
        assert client.get(f"{API}/libraries/Movies/style").json()["saved"]
        assert client.delete(f"{API}/styles/mine").status_code == 409  # in use

        # no style in the request: the library's choice, solid black band from its saved values
        from io import BytesIO

        from PIL import Image

        response = client.post(f"{API}/preview", json={"rating_key": "4635", "library": "Movies"})
        assert response.status_code == 200, response.text
        assert sum(Image.open(BytesIO(response.content)).convert("RGB").getpixel((500, 1450))) < 15
        assert client.post(f"{API}/preview", json={"rating_key": "4635"}).status_code == 422


def test_posters_page_carries_studio_state(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        client.app.state.db.execute(
            "INSERT INTO overlay_applied (rating_key, library_key, title, original_sha256, uploaded_sha256, style, applied_at, updated_at) "
            "VALUES ('501', '1', 'Dune', 'a', 'b', 'modern-streaming', 100, 100)"
        )
        page = client.get(f"{API}/libraries/Movies/posters").json()
        assert page["total"] >= 1
        dune = next(item for item in page["items"] if item["rating_key"] == "501")
        assert dune["studio_poster"] and dune["style"] == "modern-streaming" and dune["thumb"]
        assert not next(item for item in page["items"] if item["rating_key"] != "501")["studio_poster"]
        assert client.get(f"{API}/libraries/Films/posters").status_code == 404
