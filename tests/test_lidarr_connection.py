"""Lidarr's connection, kept by Studio (Kometa has no lidarr: block): encrypted in SQLite, tested against Lidarr's v1 API."""

import asyncio

import httpx
import pytest
from cryptography.fernet import Fernet
from fakelidarr import LIDARR_KEY, LIDARR_URL, FakeLidarr

from starr_studio import arr
from starr_studio.arr import ArrProblem, Connection, LidarrOptions
from starr_studio.crypto import SecretBox
from starr_studio.db import get_setting, open_database


@pytest.fixture
def db(tmp_path):
    conn = open_database(tmp_path / "studio.db")
    yield conn
    conn.close()


def test_the_connection_is_kept_encrypted_with_its_defaults(db):
    box = SecretBox(Fernet.generate_key())
    assert arr.lidarr_connection(db, box) is None and arr.lidarr_options(db) == LidarrOptions()
    arr.save_lidarr(db, box, Connection(LIDARR_URL, LIDARR_KEY, ("seed", "pw")), LidarrOptions(root_folder_path="/music", quality_profile="Lossless", metadata_profile="Standard"))
    saved = get_setting(db, arr.LIDARR)
    assert LIDARR_KEY not in str(saved) and "pw" not in str(saved)
    assert arr.lidarr_connection(db, box) == Connection(LIDARR_URL, LIDARR_KEY, ("seed", "pw"))
    assert arr.lidarr_options(db).quality_profile == "Lossless"
    assert arr.lidarr_connection(db, SecretBox(Fernet.generate_key())) is None  # the key changed: no connection, not a crash
    arr.remove_lidarr(db)
    assert arr.lidarr_connection(db, box) is None


def test_testing_reads_folders_and_profiles_and_knows_it_is_lidarr():
    fake = FakeLidarr()

    async def go(conn):
        async with httpx.AsyncClient(transport=fake.transport()) as http:
            return await arr.test_lidarr(http, conn)

    found = asyncio.run(go(Connection(LIDARR_URL, LIDARR_KEY)))
    assert found["app"] == "Lidarr" and found["root_folders"] == ["/music"]
    assert found["quality_profiles"] == ["Any", "Lossless"] and found["metadata_profiles"] == ["Standard", "None"]
    with pytest.raises(ArrProblem, match="API key was rejected"):
        asyncio.run(go(Connection(LIDARR_URL, "wrong")))
