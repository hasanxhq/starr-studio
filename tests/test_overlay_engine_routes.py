"""POST /api/v1/overlay-engine/preview: a style drawn on one title's poster (nothing written to Plex)."""

from io import BytesIO

from fakeplex import FakePlex, overlay_poster
from PIL import Image

from tests.test_overlays import make_client

URL = "/api/v1/overlay-engine/preview"


def picture(response) -> Image.Image:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/jpeg"
    image = Image.open(BytesIO(response.content)).convert("RGB")
    assert image.size == (1000, 1500)
    return image


def near(pixel, colour, slack=12):
    return all(abs(a - b) <= slack for a, b in zip(pixel, colour))


def test_preview_on_plex_poster_then_on_kometas_backup(tmp_path):
    fake = FakePlex()
    client, config = make_client(tmp_path, fake_plex=fake)
    with client:
        response = client.post(URL, json={"rating_key": "4635", "style": "modern-streaming"})
        image = picture(response)
        assert response.headers["x-poster-source"] == "plex"
        assert near(image.getpixel((500, 700)), (40, 90, 160))  # the poster, untouched in the middle
        assert sum(image.getpixel((990, 1400))) < sum((40, 90, 160)) / 2  # under the dark band
        assert near(image.getpixel((60, 60)), (40, 90, 160))  # no NEW tag: isn't drawn: Poor Things was added long ago
        metadata_calls = sum(1 for r in fake.requests if r.url.path == "/library/metadata/4635")

        (config / "overlays" / "Movies Original Posters" / "4635.jpg").write_bytes(overlay_poster((200, 30, 30)))
        response = client.post(URL, json={"rating_key": "4635", "style": "modern-streaming", "library": "Movies", "values": {"band": 0}})
        image = picture(response)
        assert response.headers["x-poster-source"] == "original"
        assert near(image.getpixel((500, 700)), (200, 30, 30)) and near(image.getpixel((990, 1400)), (200, 30, 30))  # band at 0%
        assert sum(1 for r in fake.requests if r.url.path == "/library/metadata/4635") == metadata_calls  # facts came from the cache


def test_preview_with_a_style_file(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    style = 'studio_style: 1\nname: Dot\nelements:\n  - { type: rect, box: { left: 0, top: 0, width: 100, height: 100 }, fill: { colour: "#FFFFFF" } }\n'
    with client:
        image = picture(client.post(URL, json={"rating_key": "8586", "yaml": style}))
        assert near(image.getpixel((50, 50)), (255, 255, 255)) and near(image.getpixel((500, 700)), (40, 90, 160))


def test_preview_says_what_is_wrong(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    bad_svg = "studio_style: 1\nname: x\nelements:\n  - { type: svg, svg: '<script/>', width: 10, height: 10, box: { left: 0, top: 0 } }\n"
    cases = [
        ({"rating_key": "4635"}, 422, "style name or a style file"),
        ({"rating_key": "4635", "style": "modern-streaming", "yaml": "x"}, 422, "style name or a style file"),
        ({"rating_key": "4635", "style": "nope"}, 404, "No style called"),
        ({"rating_key": "4635", "style": "modern-streaming", "values": {"band": 120}}, 422, "outside"),
        ({"rating_key": "4635", "yaml": "studio_style: 1\nname: x\nelements: []"}, 422, "elements"),
        ({"rating_key": "4635", "yaml": bad_svg}, 422, "isn't allowed"),
        ({"rating_key": "4635", "style": "modern-streaming", "library": "Films"}, 404, "no library called Films"),
        ({"rating_key": "999999", "style": "modern-streaming"}, 404, ""),
        ({"rating_key": "../1", "style": "modern-streaming"}, 422, ""),
    ]
    with client:
        for body, status, words in cases:
            response = client.post(URL, json=body)
            assert response.status_code == status, (body, response.text)
            assert words in response.text, (body, response.text)
