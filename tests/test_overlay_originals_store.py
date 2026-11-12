import io

import pytest
from PIL import Image

from starr_studio.overlay_engine.originals import OriginalsStore


def image_bytes(fmt: str, colour="red", size=(40, 60)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, colour).save(out, fmt)
    return out.getvalue()


def test_add_then_current_round_trips(tmp_path):
    store = OriginalsStore(tmp_path)
    added = store.add("123", image_bytes("PNG"))
    assert store.current("123") == added
    assert added.path.read_bytes() == image_bytes("PNG")
    assert len(added.sha256) == 64 and added.path.name == f"{added.sha256[:16]}.png"


def test_same_bytes_twice_keeps_one_file(tmp_path):
    store = OriginalsStore(tmp_path)
    store.add("1", image_bytes("PNG"))
    store.add("1", image_bytes("PNG"))
    assert sorted(p.name for p in (tmp_path / "1").iterdir() if p.name != "current") == [store.current("1").path.name]


def test_second_original_becomes_current_and_first_stays(tmp_path):
    store = OriginalsStore(tmp_path)
    first = store.add("1", image_bytes("PNG", "red"))
    second = store.add("1", image_bytes("PNG", "blue"))
    assert store.current("1") == second
    assert first.path.exists() and first.path != second.path


def test_extension_follows_format(tmp_path):
    store = OriginalsStore(tmp_path)
    assert store.add("1", image_bytes("PNG")).path.suffix == ".png"
    assert store.add("1", image_bytes("JPEG")).path.suffix == ".jpg"
    assert store.add("1", image_bytes("GIF")).path.suffix == ".img"


def test_non_image_raises_and_leaves_nothing(tmp_path):
    with pytest.raises(ValueError, match="Not an image"):
        OriginalsStore(tmp_path).add("1", b"not an image")
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("key", ["", "../x", "12a", "1/2"])
def test_bad_rating_key(tmp_path, key):
    store = OriginalsStore(tmp_path)
    with pytest.raises(ValueError):
        store.add(key, image_bytes("PNG"))
    with pytest.raises(ValueError):
        store.current(key)


def test_working_copy_is_poster_sized_and_cached(tmp_path):
    store = OriginalsStore(tmp_path)
    original = store.add("1", image_bytes("JPEG"))
    work = original.path.with_name(f"work-{original.sha256[:16]}.png")
    image = Image.open(io.BytesIO(store.working_copy(original)))
    assert (image.format, image.size) == ("PNG", (1000, 1500))
    mtime = work.stat().st_mtime_ns
    assert store.working_copy(original) == work.read_bytes()
    assert work.stat().st_mtime_ns == mtime


def test_current_none_when_unknown_or_file_missing(tmp_path):
    store = OriginalsStore(tmp_path)
    assert store.current("9") is None
    original = store.add("1", image_bytes("PNG"))
    (tmp_path / "1" / "current").write_text("gone.png")
    assert store.current("1") is None
    assert original.path.exists()
