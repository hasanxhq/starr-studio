"""A fake Lidarr behind an httpx.MockTransport (shapes from Lidarr's v1 API source: Lidarr.Api.V1 and NzbDrone.Core).

``catalogue`` is what Lidarr's metadata server knows (``/album/lookup``); ``albums`` and ``artists`` are what's in
Lidarr. Adding an album adds its artist when Lidarr doesn't have them yet (AddAlbumService.AddAlbum), and refuses an
album Lidarr already has (AlbumExistsValidator): that one is monitored with ``PUT /album/monitor`` instead.
"""

import base64
import json
from datetime import datetime

import httpx

LIDARR_URL = "http://lidarr.test:8686"
LIDARR_KEY = "lidarr-key"


def catalogue_album(mbid: str, title: str, artist: str, artist_mbid: str, year: int) -> dict:
    """An album as ``/album/lookup`` returns it: not in Lidarr (no id), its artist inline."""
    return {
        "title": title,
        "foreignAlbumId": mbid,
        "releaseDate": f"{year}-05-21T00:00:00Z",
        "albumType": "Album",
        "artistId": 0,
        "artist": {"artistName": artist, "foreignArtistId": artist_mbid},
        "images": [{"coverType": "cover", "url": f"/MediaCover/{mbid}.jpg", "remoteUrl": f"https://coverart.test/{mbid}.jpg"}],
    }


class FakeLidarr:
    def __init__(self) -> None:
        self.catalogue: list[dict] = [
            catalogue_album("b1392450-e666-3926-a536-22c65f834433", "OK Computer", "Radiohead", "a74b1b7f-71a5-4011-9441-d0b5e4122711", 1997),
            catalogue_album("1834eae1-741b-3c03-9ca5-0df3decb43ea", "Kid A", "Radiohead", "a74b1b7f-71a5-4011-9441-d0b5e4122711", 2000),
            catalogue_album("f5093c06-23e3-404f-aeaa-40f72885ee3a", "Blue Lines", "Massive Attack", "10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8", 1991),
        ]
        self.albums: dict[int, dict] = {}  # in Lidarr, by id
        self.artists: dict[int, dict] = {}
        self.history: list[dict] = []
        self.queue: list[dict] = []  # {"albumId", "status", "title"}
        self.commands: list[dict] = []
        self.tags: list[dict] = []
        self.down = False
        self.proxy_login: tuple[str, str] | None = None
        self.requests: list[httpx.Request] = []
        self._next_id = 100

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def _id(self) -> int:
        self._next_id += 1
        return self._next_id

    # --- Setting the scene ---------------------------------------------------------

    def add_existing(self, mbid: str, monitored: bool = False, track_files: int = 0, tracks: int = 10) -> dict:
        """Put a catalogue album (and its artist) in Lidarr, as when Lidarr already follows the artist."""
        found = next(a for a in self.catalogue if a["foreignAlbumId"] == mbid)
        artist = self._artist(found["artist"], monitored=True)
        album = found | {"id": self._id(), "artistId": artist["id"], "monitored": monitored, "artist": artist}
        album["statistics"] = {"trackFileCount": track_files, "trackCount": tracks, "percentOfTracks": 100.0 * track_files / tracks if tracks else 0.0}
        self.albums[album["id"]] = album
        return album

    def imported(self, album_id: int, at: datetime, track: str = "Airbag") -> None:
        """A track file of an album in Lidarr imported (history event 3, TrackFileImported)."""
        album = self.albums[album_id]
        album["statistics"]["trackFileCount"] = min(album["statistics"]["trackFileCount"] + 1, album["statistics"]["trackCount"])
        stats = album["statistics"]
        stats["percentOfTracks"] = 100.0 * stats["trackFileCount"] / stats["trackCount"]
        record = {
            "id": self._id(),
            "albumId": album_id,
            "artistId": album["artistId"],
            "eventType": "trackFileImported",
            "date": at.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            "sourceTitle": f"{album['artist']['artistName']} - {album['title']} - {track}",
            "artist": {"artistName": album["artist"]["artistName"], "foreignArtistId": album["artist"]["foreignArtistId"]},
            "album": {"title": album["title"], "foreignAlbumId": album["foreignAlbumId"], "releaseDate": album["releaseDate"]},
        }
        self.history.append(record)

    def _artist(self, artist: dict, monitored: bool, **settings) -> dict:
        for existing in self.artists.values():
            if existing["foreignArtistId"] == artist["foreignArtistId"]:
                return existing
        added = {"id": self._id(), "artistName": artist["artistName"], "foreignArtistId": artist["foreignArtistId"], "monitored": monitored} | settings
        self.artists[added["id"]] = added
        return added

    # --- The API -------------------------------------------------------------------

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down or not str(request.url).startswith(LIDARR_URL):
            raise httpx.ConnectError("Connection refused", request=request)
        if self.proxy_login and request.headers.get("Authorization") != "Basic " + base64.b64encode(":".join(self.proxy_login).encode()).decode():
            return httpx.Response(401, text="<html>nginx</html>", headers={"WWW-Authenticate": 'Basic realm="Lidarr"'})
        if request.headers.get("X-Api-Key") != LIDARR_KEY:
            return httpx.Response(401)
        path, method, params = request.url.path, request.method, request.url.params
        body = json.loads(request.content) if request.content else None

        if path == "/api/v1/system/status":
            return httpx.Response(200, json={"appName": "Lidarr", "version": "2.9.6.4552"})
        if path == "/api/v1/rootfolder":
            return httpx.Response(200, json=[{"id": 1, "path": "/music"}])
        if path == "/api/v1/qualityprofile":
            return httpx.Response(200, json=[{"id": 1, "name": "Any"}, {"id": 2, "name": "Lossless"}])
        if path == "/api/v1/metadataprofile":
            return httpx.Response(200, json=[{"id": 1, "name": "Standard"}, {"id": 2, "name": "None"}])
        if path == "/api/v1/tag":
            if method == "POST":
                tag = {"id": self._id(), "label": body["label"]}
                self.tags.append(tag)
                return httpx.Response(201, json=tag)
            return httpx.Response(200, json=self.tags)
        if path == "/api/v1/history/since":
            since = params["date"]
            event = params.get("eventType")
            found = [r for r in self.history if r["date"][:19] >= since[:19] and (event is None or event == "3")]
            return httpx.Response(200, json=found)
        if path == "/api/v1/album/lookup":
            term = params.get("term", "").casefold()
            if term.startswith("lidarr:"):
                found = [a for a in self.catalogue if a["foreignAlbumId"] == term[len("lidarr:") :]]
            else:
                found = [a for a in self.catalogue if term in a["title"].casefold() or term in a["artist"]["artistName"].casefold()]
            in_lidarr = {a["foreignAlbumId"]: a for a in self.albums.values()}
            return httpx.Response(200, json=[in_lidarr.get(a["foreignAlbumId"], a) for a in found])
        if path == "/api/v1/album" and method == "GET":
            mbid = params.get("foreignAlbumId")
            return httpx.Response(200, json=[a for a in self.albums.values() if mbid is None or a["foreignAlbumId"] == mbid])
        if path == "/api/v1/album" and method == "POST":
            return self._add_album(body)
        if path == "/api/v1/album/monitor" and method == "PUT":
            for album_id in body["albumIds"]:
                self.albums[album_id]["monitored"] = body["monitored"]
            return httpx.Response(202, json=[self.albums[i] for i in body["albumIds"]])
        if path.startswith("/api/v1/album/"):
            album_id = int(path.rsplit("/", 1)[1])
            if album_id not in self.albums:
                return httpx.Response(404, json={"message": "Not Found"})
            if method == "DELETE":
                del self.albums[album_id]
                return httpx.Response(200)
            return httpx.Response(200, json=self.albums[album_id])
        if path == "/api/v1/artist":
            return httpx.Response(200, json=list(self.artists.values()))
        if path == "/api/v1/queue":
            return httpx.Response(200, json={"page": 1, "pageSize": 1000, "totalRecords": len(self.queue), "records": self.queue})
        if path == "/api/v1/command" and method == "POST":
            command = {"id": self._id(), "name": body["name"], "status": "queued", "body": body}
            self.commands.append(command)
            return httpx.Response(201, json=command)
        return httpx.Response(404, json={"message": "Not Found"})

    def _add_album(self, body: dict) -> httpx.Response:
        mbid = body.get("foreignAlbumId")
        if any(a["foreignAlbumId"] == mbid for a in self.albums.values()):
            return httpx.Response(400, json=[{"propertyName": "ForeignAlbumId", "errorMessage": "This album has already been added."}])
        found = next((a for a in self.catalogue if a["foreignAlbumId"] == mbid), None)
        artist_in = body.get("artist") or {}
        if found is None or not artist_in.get("foreignArtistId"):
            return httpx.Response(400, json=[{"propertyName": "ForeignAlbumId", "errorMessage": "Album not found"}])
        for field in ("qualityProfileId", "metadataProfileId", "rootFolderPath"):
            if not artist_in.get(field):
                return httpx.Response(400, json=[{"propertyName": f"Artist.{field}", "errorMessage": f"'{field}' must not be empty."}])
        settings = {k: artist_in.get(k) for k in ("qualityProfileId", "metadataProfileId", "rootFolderPath", "monitorNewItems", "addOptions", "tags")}
        artist = self._artist(found["artist"], monitored=bool(artist_in.get("monitored", True)), **settings)
        album = found | {
            "id": self._id(),
            "artistId": artist["id"],
            "artist": artist,
            "monitored": bool(body.get("monitored", True)),
            "addOptions": body.get("addOptions") or {},
            "statistics": {"trackFileCount": 0, "trackCount": 10, "percentOfTracks": 0.0},
        }
        self.albums[album["id"]] = album
        return httpx.Response(201, json=album)
