"""Stands in for Streamline's playback API until the server side lands.

Proxies /extensions/player/playback/* to the engine's control plane and mints the HLS
token like Streamline will (HMAC-SHA256 over "hls|<id>|<exp>"). Pairing hands out
device keys; a request with an unknown key gets 401, one with no key passes (the
headless harness sends none). Approve, deny and revoke from the command line:
POST /dev/approve, /dev/deny, /dev/revoke. Watch state lives in memory. Files are analyzed, their subtitles extracted and their trickplay sheets built at start,
as Streamline does at import; a session opened before that finishes probes instead,
and its tracks read as still preparing.

The library is dev/mock-library.json, in Streamline's shapes, with its titles played
by the --clip files in turn. A --media id shows up as a movie of that name, playing its
own file. --art points at p/<slug>.jpg and b/<slug>.jpg artwork, and c/<person>.jpg headshots.

    python3 dev/mock-streamline.py --secret <engine secret> --art /path/to/img \
        --clip /path/to/clip.mkv [--clip ...] [--media film=/path/to/film.mkv ...]

Server settings (/extensions/player/admin) answers 403 to a member (--role member, or POST /dev/role/member|admin).
--demo-admin serves the design's sample; --read-only locks the engine's settings. Settings are the engine's four keys,
held here unless --engine-settings forwards them (and the restart) to the engine, and the player's own six
(engine.url, engine.public_url, player.url, player.origins, player.app_links, network.home), which apply at once; --player-url
is the first value of player.url. An admin restart takes the engine down for ten seconds (--restart-hangs: for ever, until
POST /dev/admin/restart/finish): the overview then says `engine.reachable: false`, the engine's settings are absent, and the players
learn of it as server_restarting. POST /dev/admin/fail/save|action makes every admin write of that kind answer 500
until /dev/admin/fail/off, POST /dev/admin/scan/finish ends running scans at once, and POST
/dev/admin/read-only/engine|off switches the lock while it runs. POST /dev/admin/streams/clear,
/dev/admin/pairing (the demo request again), /dev/admin/pairing/expire, /dev/admin/player-url/off and
/dev/admin/restart-hangs/on|off and /dev/admin/restart/finish
reshape the demo while it runs. Me.streamline_url is the address the call came to, and the account's name and email are
edited in Streamline, not here.

Downloads (/extensions/player/downloads) are for a device key and prepared by the engine's download job; POST /dev/downloads/fail makes
the next one end failed. A download event reaches only the device that made it.

The public URL defaults to 10.0.2.2, the Android emulator's alias for the host.
"""

import argparse
import base64
import datetime
import hashlib
import hmac
import ipaddress
import itertools
import json
import math
import os
import re
import secrets
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN_TTL = 6 * 3600
MEDIA_TTL = 12 * 3600

p = argparse.ArgumentParser()
p.add_argument("--listen", default="0.0.0.0:8080")
p.add_argument("--engine", default="http://127.0.0.1:8097")
p.add_argument("--public", default="http://10.0.2.2:8097", help="engine URL as the device sees it")
p.add_argument("--secret", required=True)
p.add_argument("--media", action="append", default=[], help="id=path, repeatable")
p.add_argument(
    "--clip", action="append", default=[], help="file the library's titles play, repeatable"
)
p.add_argument(
    "--demo-markers",
    action="store_true",
    help="give episodes an intro and credits, to see the cards",
)
p.add_argument("--art", default="", help="directory holding the artwork")
p.add_argument(
    "--network",
    choices=["home", "away"],
    default="away",
    help="where Streamline places this device; away is what a missing answer means",
)
p.add_argument(
    "--now",
    type=float,
    help="epoch seconds shown timestamps count from (token expiry stays real), to pin dates for screenshot runs",
)
p.add_argument("--cors-origin", action="append", help="origin a browser may call from, repeatable")
p.add_argument("--access-ttl", type=int, default=900, help="seconds a browser's access token lasts")
p.add_argument(
    "--refresh-ttl", type=int, default=2592000, help="seconds a browser's refresh token lasts"
)
p.add_argument(
    "--library",
    default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock-library.json"),
    help="library JSON to serve in place of the demo one; its titles take the --clip files in order, movies first",
)
p.add_argument("--empty", action="store_true", help="serve a library with no titles in it")
p.add_argument(
    "--demo-activity",
    nargs="?",
    const="all",
    choices=["all", "no-downloads"],
    help="serve the design's eleven activity events instead of the library's arrivals; no-downloads leaves out the download",
)
p.add_argument(
    "--demo-progress",
    action="store_true",
    help="start with Dune: Part Two and Severance S2 E4 partly watched",
)
p.add_argument(
    "--sso-deny", action="store_true", help="have Streamline's sign-in page refuse every sign-in"
)
p.add_argument(
    "--player-url",
    help="the first value of the player.url setting: the player web app's URL, which pairing links point at (/pair)",
)
p.add_argument("--pair-ttl", type=int, default=600, help="seconds a pairing lasts")
p.add_argument(
    "--demo-admin",
    action="store_true",
    help="serve the design's sample for Server settings (streams, pairings, devices, library, overview) instead of what the mock itself holds",
)
p.add_argument(
    "--role",
    choices=["admin", "member"],
    default="admin",
    help="the signed-in user's role; a member gets 403 from every admin path",
)
p.add_argument(
    "--read-only",
    action="store_const",
    const="engine",
    help="lock the engine's settings, as a config file mounted read-only does",
)
p.add_argument("--restart-hangs", action="store_true", help="an admin restart never comes back")
p.add_argument(
    "--engine-settings",
    action="store_true",
    help="forward the engine-owned settings and the restart to the engine's /v1/settings and /v1/restart",
)
p.add_argument(
    "--heartbeat-timeout",
    type=float,
    default=90,
    help="seconds without a heartbeat before a session is stopped",
)
args = p.parse_args()
CORS_ORIGINS = args.cors_origin or ["http://localhost:1430", "http://127.0.0.1:1430"]
USER_EMAIL = "antoine@example.net"
PICTURE_MAX = 512 * 1024
PICTURE_TYPES = ("image/jpeg", "image/png", "image/webp")
USERS = [
    {"id": 1, "name": "Antoine Langlois", "role": "Admin"},
    {"id": 2, "name": "Camille Roux", "role": "Member"},
    {"id": 3, "name": "Hugo Bernard", "role": "Member"},
]
ME = {
    "id": 1,
    "name": "Antoine Langlois",
    "email": USER_EMAIL,
    "role": "Member" if args.role == "member" else "Admin",
    "library_language": "en",
}
PICTURE = {"data": None, "type": ""}
ART_ON = {"on": True}
ARRIVAL_DAYS = 7
BITRATE = {"2160p": 40_000_000, "1080p": 12_000_000}


def shown_now():
    return time.time() if args.now is None else args.now


def stamp():
    return datetime.datetime.fromtimestamp(shown_now(), datetime.UTC).isoformat()


FILES = dict(m.split("=", 1) for m in args.media)
MEDIA = dict(FILES)
ANALYSIS = {}
SUBTITLES = {}
TRICKPLAY = {}
MARKERS = {}
SESSIONS = {}
LAST_BEAT = {}
# What an admin did, for the next heartbeat to tell: sid -> (by, message), and a restart's end time.
STOPPED = {}
RESTART = {"until": 0.0, "by": "", "message": "", "admin": False}
ADMIN = "Antoine Langlois"
PAIRINGS = {}
KEYS = {}
PAIR_TTL = args.pair_ttl
PAIR_INTERVAL = max(1, min(5, PAIR_TTL // 2))
# The design's codes: 6 characters shown as XXX-XXX, no vowels, no 0/O or 1/I.
CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"
# Browser sign-in: one-time codes, access tokens, and a device per browser holding its refresh token chain.
CODES = {}
ACCESS = {}
BROWSERS = {}
REFRESH = {}
WATCH = {}
WATCHED_AT = 0.9
DOWNLOADS = {}
DOWNLOAD_QUALITIES = {
    "original": {},
    "1080p": {"max_bitrate": 8_000_000, "max_height": 1080},
    "720p": {"max_bitrate": 4_000_000, "max_height": 720},
}
DOWNLOAD_FAIL = {"next": False}

with open(args.library) as f:
    LIBRARY = json.load(f)
MOVIES = [] if args.empty else LIBRARY["movies"]
SERIES = [] if args.empty else LIBRARY["series"]
PEOPLE = LIBRARY.get("people", {})
REFS = {}
clips = itertools.cycle(args.clip or list(FILES.values())) if args.clip or FILES else None
for number, media_id in enumerate(FILES):
    MOVIES.insert(
        number,
        {
            "id": 1000 + number,
            "slug": media_id,
            "title": media_id,
            "original_title": media_id,
            "year": 2026,
            "overview": "",
            "runtime": 0,
            "status": "available",
            "monitored": True,
            "tmdb_id": 0,
            "genres": ["Test"],
            "rating": 0,
            "added_at": stamp(),
            "file_summary": {"file_count": 1},
            "media_files": [{"id": media_id}],
        },
    )
for movie in MOVIES:
    media_id = movie["media_files"][0]["id"]
    if clips:
        MEDIA.setdefault(media_id, next(clips))
    REFS[media_id] = {"movie_id": movie["id"]}
for show in SERIES:
    for season in show["seasons"]:
        for episode in season["episodes"]:
            if clips:
                MEDIA.setdefault(episode["media_file_id"], next(clips))
            REFS[episode["media_file_id"]] = {
                "series_id": show["id"],
                "season": season["number"],
                "episode_id": episode["id"],
            }


if args.demo_progress and not args.empty:
    dune = next(m for m in MOVIES if m["slug"] == "dune2")
    severance = next(s for s in SERIES if s["slug"] == "severance")
    episode = severance["seasons"][1]["episodes"][3]
    for offset, (media_id, runtime, fraction) in enumerate(
        [
            (episode["media_file_id"], episode["runtime"], 0.3),
            (dune["media_files"][0]["id"], dune["runtime"], 0.4),
        ]
    ):
        duration = runtime * 60
        WATCH[media_id] = {
            **REFS[media_id],
            "media_id": media_id,
            "position_seconds": int(duration * fraction),
            "duration_seconds": duration,
            "watched": False,
            "updated_at": datetime.datetime.fromtimestamp(
                shown_now() - offset * 3600, datetime.UTC
            ).isoformat(),
        }


def file_size(title, runtime):
    return (
        runtime * 60 * BITRATE.get(title.get("file_summary", {}).get("resolution"), 8_000_000) // 8
    )


for movie in MOVIES:
    if "resolution" in movie.get("file_summary", {}):
        movie["file_summary"]["size"] = file_size(movie, movie["runtime"])
for show in SERIES:
    show["file_summary"]["size"] = file_size(
        show, sum(e["runtime"] for s in show["seasons"] for e in s["episodes"] if e["has_file"])
    )


def initials(name):
    words = name.split()
    return "".join(w[0] for w in (words[:1] + words[-1:] if len(words) > 1 else words)).upper()


def profile(host):
    return {
        **ME,
        "picture": PICTURE["data"] is not None,
        "initials": initials(ME["name"]),
        "streamline_url": f"http://{host}",
        "player_url": SETTINGS["player.url"] or None,
    }


def home():
    """Featured titles and the last week's arrivals, from the library and the watch state."""
    window = (
        datetime.datetime.fromtimestamp(shown_now(), datetime.UTC)
        - datetime.timedelta(days=ARRIVAL_DAYS)
    ).date()
    by_key = {("movies", m["id"]): m for m in MOVIES} | {("series", s["id"]): s for s in SERIES}
    featured, arrivals = [], []
    for w in sorted(WATCH.values(), key=lambda w: w["updated_at"], reverse=True):
        key = ("movies", w["movie_id"]) if "movie_id" in w else ("series", w.get("series_id"))
        if (
            key in by_key
            and not w["watched"]
            and w["position_seconds"] > 0
            and all(f["kind"] != key[0] or f["id"] != key[1] for f in featured)
        ):
            featured.append(
                {
                    "kind": key[0],
                    "id": key[1],
                    "reason": "continue",
                    **({"season": w["season"]} if "season" in w else {}),
                }
            )
    for show in sorted(SERIES, key=lambda s: s["added_at"], reverse=True):
        added = datetime.datetime.fromisoformat(show["added_at"])
        if added.date() < window:
            continue
        latest = show["seasons"][-1]
        if len(show["seasons"]) > 1:
            numbers = [e["number"] for e in latest["episodes"][-2:]]
            arrivals.append(
                (
                    added,
                    {
                        "kind": "series",
                        "id": show["id"],
                        "at": added.isoformat(),
                        "season": latest["number"],
                        "episodes": numbers,
                    },
                )
            )
            if all(f["kind"] != "series" or f["id"] != show["id"] for f in featured):
                featured.append(
                    {
                        "kind": "series",
                        "id": show["id"],
                        "reason": "new_episodes",
                        "season": latest["number"],
                        "episodes": numbers,
                    }
                )
        else:
            arrivals.append((added, {"kind": "series", "id": show["id"], "at": added.isoformat()}))
    for movie in sorted(MOVIES, key=lambda m: m["added_at"], reverse=True):
        added = datetime.datetime.fromisoformat(movie["added_at"])
        if added.date() >= window:
            arrivals.append((added, {"kind": "movies", "id": movie["id"], "at": added.isoformat()}))
    taken = {(f["kind"], f["id"]) for f in featured}
    for movie in sorted(MOVIES, key=lambda m: m["added_at"], reverse=True):
        if ("movies", movie["id"]) not in taken:
            featured.append({"kind": "movies", "id": movie["id"], "reason": "added"})
    days = {}
    for added, item in sorted(arrivals, key=lambda a: a[0], reverse=True):
        days.setdefault(added.date().isoformat(), []).append(item)
    return {
        "featured": featured[:3],
        "arrivals": [{"date": d, "items": items} for d, items in days.items()],
    }


def activity_events():
    """The feed, newest first: the design's sample events, or one per arrival in the library, all read."""
    if args.empty:
        return []
    if args.demo_activity:
        now = shown_now()
        at = lambda seconds: datetime.datetime.fromtimestamp(
            now - seconds, datetime.UTC
        ).isoformat()
        minute, hour, day = 60, 3600, 86400
        events = [
            {
                "id": "a1",
                "kind": "episodes",
                "at": at(10 * minute),
                "read": False,
                "title": {"kind": "series", "id": 1},
                "season": 2,
                "episodes": [8, 9],
            },
            {
                "id": "a2",
                "kind": "download",
                "at": at(52 * minute),
                "read": False,
                "title": {"kind": "series", "id": 2},
                "season": 1,
                "episodes": [10],
            },
            {
                "id": "a4",
                "kind": "movie",
                "at": at(2 * hour + 25 * minute),
                "read": True,
                "title": {"kind": "movies", "id": 2},
                "file": {"resolution": "2160p", "hdr": "HDR10", "audio": "Atmos"},
            },
            {
                "id": "a3",
                "kind": "upgrade",
                "at": at(5 * hour + 45 * minute),
                "read": False,
                "title": {"kind": "movies", "id": 3},
                "file": {"resolution": "2160p", "hdr": "Dolby Vision"},
                "previous": {"resolution": "1080p"},
            },
            {
                "id": "a7",
                "kind": "movie",
                "at": at(14 * hour + 30 * minute),
                "read": True,
                "title": {"kind": "movies", "id": 4},
                "file": {"resolution": "1080p", "audio": "EAC3", "channels": "5.1"},
            },
            {
                "id": "a5",
                "kind": "device",
                "at": at(17 * hour),
                "read": True,
                "device": {"name": "iPhone 16 Pro", "platform": "ios", "location": "Lyon, France"},
            },
            {
                "id": "a6",
                "kind": "season",
                "at": at(19 * hour),
                "read": True,
                "title": {"kind": "series", "id": 2},
                "season": 1,
                "episode_count": 10,
            },
            {
                "id": "a8",
                "kind": "server",
                "at": at(33 * hour),
                "read": True,
                "server": {"version": "2.4.1", "restart_seconds": 12},
            },
            {
                "id": "a9",
                "kind": "movie",
                "at": at(4 * day),
                "read": True,
                "title": {"kind": "movies", "id": 6},
                "file": {"resolution": "2160p", "hdr": "Dolby Vision"},
            },
            {
                "id": "a10",
                "kind": "season",
                "at": at(5 * day),
                "read": True,
                "title": {"kind": "series", "id": 3},
                "season": 1,
                "episode_count": 8,
            },
            {
                "id": "a11",
                "kind": "scan",
                "at": at(6 * day),
                "read": True,
                "scan": {"added": 4, "upgraded": 2, "errors": 0},
            },
        ]
        return [e for e in events if not (args.demo_activity == "no-downloads" and e["id"] == "a2")]
    arrivals = []
    for movie in MOVIES:
        arrivals.append(
            (
                movie["added_at"],
                {
                    "id": f"m{movie['id']}",
                    "kind": "movie",
                    "at": movie["added_at"],
                    "read": True,
                    "title": {"kind": "movies", "id": movie["id"]},
                    **(
                        {
                            "file": {
                                k: v for k, v in movie["file_summary"].items() if k != "file_count"
                            }
                        }
                        if movie.get("file_summary")
                        else {}
                    ),
                },
            )
        )
    for show in SERIES:
        latest = show["seasons"][-1]
        arrivals.append(
            (
                show["added_at"],
                {
                    "id": f"s{show['id']}",
                    "kind": "season",
                    "at": show["added_at"],
                    "read": True,
                    "title": {"kind": "series", "id": show["id"]},
                    "season": latest["number"],
                    "episode_count": len(latest["episodes"]),
                },
            )
        )
    return [e for _, e in sorted(arrivals, key=lambda a: a[0], reverse=True)][:100]


ACTIVITY = activity_events()


def summary(item):
    return {k: v for k, v in item.items() if k not in ("media_files", "seasons", "cast")}


def series_summary(show):
    files = [e["media_file_id"] for s in show["seasons"] for e in s["episodes"] if e["has_file"]]
    rows = [WATCH[f] for f in files if f in WATCH]
    return {
        **summary(show),
        "episodes": {
            "total": len(files),
            "watched": sum(1 for w in rows if w["watched"]),
            "started": sum(1 for w in rows if w["watched"] or w["position_seconds"] > 0),
        },
    }


def norm_title(s):
    return re.sub(
        r"[^a-z0-9]+",
        "",
        unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower(),
    )


def person(pid):
    """A person page: their credits on this server, and what they are known for (TMDB-style)."""
    if pid not in PEOPLE:
        return None
    credits, here = [], {}
    for kind, items in (("movies", MOVIES), ("series", SERIES)):
        for t in items:
            here[norm_title(t["title"])] = (kind, t["id"])
            for c in t.get("cast", []):
                if c["id"] == pid:
                    credit = {
                        "kind": kind,
                        "id": t["id"],
                        "title": t["title"],
                        "year": t["year"],
                        "character": c["character"],
                    }
                    if kind == "series":
                        credit.update(
                            seasons=c.get("seasons", []), total_seasons=t.get("total_seasons")
                        )
                    credits.append(credit)
    known = []
    for k in PEOPLE[pid]["known_for"]:
        found = here.get(norm_title(k["title"]))
        known.append({**k, **({"kind": found[0], "id": found[1]} if found else {})})
    return {
        "id": pid,
        "name": PEOPLE[pid]["name"],
        "department": "Acting",
        "credits": credits,
        "known_for": known,
    }


def art(kind, item_id, name):
    items = MOVIES if kind == "movies" else SERIES
    slug = next((i["slug"] for i in items if str(i["id"]) == item_id), None)
    if not ART_ON["on"] or not slug:
        return None
    if name == "poster-w342":
        # The extension serves the poster itself when it has no card-sized copy.
        small = os.path.join(args.art, "p", f"{slug}-w342.jpg")
        return small if os.path.exists(small) else art(kind, item_id, "poster")
    folder = {"poster": "p", "backdrop": "b"}[name]
    path = os.path.join(args.art, folder, f"{slug}.jpg")
    return path if os.path.exists(path) else None


def note_progress(sid, position):
    media_id = SESSIONS.get(sid)
    if media_id is None:
        return
    analysis = ANALYSIS.get(MEDIA[media_id], {})
    duration = analysis.get("duration", 0)
    WATCH[media_id] = {
        **REFS.get(media_id, {}),
        "media_id": media_id,
        "position_seconds": position,
        "duration_seconds": duration,
        "watched": duration > 0 and position >= WATCHED_AT * duration,
        "updated_at": stamp(),
    }


def download_url(job):
    exp = int(time.time()) + MEDIA_TTL
    sig = hmac.new(args.secret.encode(), f"dl|{job}|{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{args.public}/dl/{job}?exp={exp}&sig={sig}"


def download_view(entry):
    """The job as the client reads it: the engine's state, with a fresh URL once the file is ready."""
    view = {
        "id": entry["id"],
        "media_id": entry["media_id"],
        "state": "preparing",
        "progress": 0,
        "size": None,
        "container": None,
        "url": None,
    }
    if entry["failed"]:
        return {
            **view,
            "state": "failed",
            "error": {"code": "prepare_failed", "message": "The server couldn't prepare it."},
        }
    st, status = engine("GET", f"/v1/jobs/{entry['id']}")
    if st != 200 or status["state"] == "failed":
        return {
            **view,
            "state": "failed",
            "error": {
                "code": "prepare_failed",
                "message": (status or {}).get("error") or "The server couldn't prepare it.",
            },
        }
    if status["state"] == "done":
        result = status["result"]
        return {
            **view,
            "state": "ready",
            "progress": 1,
            "size": result["size"],
            "container": result["container"],
            "url": download_url(entry["id"]),
        }
    return {**view, "progress": status.get("progress") or 0}


def download_event(entry, device):
    ref = REFS.get(entry["media_id"], {})
    event = {
        "id": f"d{entry['id'][:8]}",
        "kind": "download",
        "at": stamp(),
        "read": False,
        "device": {"name": device["name"], "platform": device["platform"]},
        "_device": entry["device"],
    }
    if "movie_id" in ref:
        return {**event, "title": {"kind": "movies", "id": ref["movie_id"]}}
    show = next((s for s in SERIES if s["id"] == ref.get("series_id")), None)
    episode = next(
        (
            e
            for s in (show or {}).get("seasons", [])
            for e in s["episodes"]
            if e["id"] == ref.get("episode_id")
        ),
        None,
    )
    return {
        **event,
        "title": {"kind": "series", "id": ref["series_id"]},
        "season": ref["season"],
        "episodes": [episode["number"]] if episode else [],
    }


def parse_time(text):
    try:
        t = datetime.datetime.fromisoformat(text)
    except (AttributeError, ValueError):
        return None
    return (t if t.tzinfo else t.replace(tzinfo=datetime.UTC)).timestamp()


def engine(method, path, body=None):
    req = urllib.request.Request(
        args.engine + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {args.secret}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")
    except OSError:
        return 503, {"code": "engine_unreachable", "message": f"no engine at {args.engine}"}


def job_id(kind, path):
    st = os.stat(path)
    return hashlib.md5(f"{kind}|{path}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()


def run_job(kind, job=None, **params):
    job = job or secrets.token_hex(16)
    st, resp = engine(
        "POST", "/v1/jobs", {"job_id": job, "type": kind, "priority": "background", **params}
    )
    if st >= 400 and (resp or {}).get("code") != "job_exists":
        print(f"{kind} {params}: {st} {resp}", flush=True)
        return None
    while True:
        st, status = engine("GET", f"/v1/jobs/{job}")
        if st != 200 or status["state"] == "failed":
            print(f"{kind} {params}: {status}", flush=True)
            return None
        if status["state"] == "done":
            print(f"{kind} done: {params}", flush=True)
            return job, status["result"]
        time.sleep(1)


def prepare(path):
    done = run_job("analyze", path=path)
    if done:
        ANALYSIS[path] = done[1]
    done = run_job("subtitles", job=job_id("subtitles", path), path=path)
    if done:
        SUBTITLES[path] = done
    done = run_job("trickplay", job=job_id("trickplay", path), path=path)
    if done:
        TRICKPLAY[path] = done


def prepare_season(paths):
    done = run_job("intro", paths=paths)
    for found in done[1] if done else []:
        MARKERS[found["path"]] = found


def markers(media_id, path):
    if args.demo_markers and "episode_id" in REFS.get(media_id, {}):
        duration = ANALYSIS.get(path, {}).get("duration", 0)
        return {"intro": [2, 7], "credits": [duration - 8, duration]}
    found = MARKERS.get(path, {})
    return {"intro": found.get("intro"), "credits": found.get("credits")}


def media_url(job, name):
    exp = int(time.time()) + MEDIA_TTL
    sig = hmac.new(args.secret.encode(), f"media|{job}|{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{args.public}/media/{job}/{urllib.parse.quote(name)}?exp={exp}&sig={sig}"


def tracks(media_id, path):
    analysis = ANALYSIS.get(path, {})
    job, result = SUBTITLES.get(path, (None, {"tracks": [], "fonts": []}))
    url = lambda name: media_url(job, name)
    trickplay = TRICKPLAY.get(path)
    files = {
        t["index"]: {f.rsplit(".", 1)[1]: url(f) for f in t["files"]} for t in result["tracks"]
    }
    return {
        "preparing": job is None,
        "container": analysis.get("container", ""),
        "video": next(iter(analysis.get("video", [])), None),
        "chapters": analysis.get("chapters", []),
        "markers": markers(media_id, path),
        "audio": analysis.get("audio", []),
        "subtitles": [
            {**s, "files": files.get(s["index"], {})} for s in analysis.get("subtitles", [])
        ],
        "fonts": [url(f) for f in result["fonts"]],
        "trickplay": {"url": media_url(trickplay[0], "trickplay.json")} if trickplay else None,
    }


def with_url(sid, resp):
    exp = int(time.time()) + TOKEN_TTL
    sig = hmac.new(args.secret.encode(), f"hls|{sid}|{exp}".encode(), hashlib.sha256).hexdigest()
    path = f"hls/{sid}/master.m3u8" if resp["url_path"] != "file" else f"file/{sid}"
    return {"session_id": sid, **resp, "url": f"{args.public}/{path}?exp={exp}&sig={sig}"}


def issue_tokens(device_id):
    """A new access token and the next refresh token of a browser device."""
    device = BROWSERS[device_id]
    access = secrets.token_urlsafe(32)
    ACCESS[access] = {"device": device_id, "exp": time.monotonic() + args.access_ttl}
    device["used"].add(device["refresh"])
    device["refresh"] = secrets.token_urlsafe(32)
    device["expires"] = time.time() + args.refresh_ttl
    REFRESH[device["refresh"]] = device_id
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": args.access_ttl,
        "refresh_token": device["refresh"],
        "refresh_expires_in": args.refresh_ttl,
        "device_id": device_id,
    }


def new_key(device):
    """An app's device key, from a pairing or a sign-in: a known client_id gets a new key and loses its old one."""
    for k, v in list(KEYS.items()):
        if v["client_id"] == device["client_id"]:
            del KEYS[k]
    key = secrets.token_hex(24)
    KEYS[key] = {
        "client_id": device["client_id"],
        "name": device.get("name", "")[:64],
        "platform": device.get("platform", ""),
    }
    return {"api_key": key, "key_id": len(KEYS)}


def new_browser(name):
    device_id = "web-" + secrets.token_hex(8)
    BROWSERS[device_id] = {
        "name": name[:64] or "Web browser",
        "refresh": None,
        "used": set(),
        "expires": 0,
        "seen": time.time(),
    }
    BROWSERS[device_id]["refresh"] = secrets.token_urlsafe(32)
    return issue_tokens(device_id)


def revoke_browser(device_id):
    if BROWSERS.pop(device_id, None) is None:
        return False
    for token, owner in list(ACCESS.items()):
        if owner["device"] == device_id:
            del ACCESS[token]
    return True


def bearer_device(headers):
    """The browser device a Bearer header names, or None when absent, expired or revoked."""
    value = headers.get("Authorization", "")
    if not value.startswith("Bearer "):
        return None
    found = ACCESS.get(value[7:])
    if found is None or time.monotonic() > found["exp"] or found["device"] not in BROWSERS:
        return None
    return found["device"]


def pkce_matches(verifier, challenge):
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode() == challenge


# Server settings: the engine owns four keys, held here unless --engine-settings forwards them; the player owns six.
SETTING_DEFAULTS = {
    "transcoding.hw_accel": "auto",
    "transcoding.hw_device": "/dev/dri/renderD128",
    "stream.tonemap": True,
    "stream.max_live": 2,
    "engine.url": args.engine,
    "engine.public_url": args.public,
    "player.url": (args.player_url or "").rstrip("/"),
    "player.origins": [],
    "player.app_links": [],
    "network.home": [],
}
ENGINE_KEYS = {
    "transcoding.hw_accel": "hw_accel",
    "transcoding.hw_device": "hw_device",
    "stream.tonemap": "tonemap",
    "stream.max_live": "max_transcodes",
}
# Read once at boot, so a change waits for a restart; the engine reads its whole config that way.
RESTART_KEYS = list(ENGINE_KEYS)
URL_KEYS = {"engine.url", "engine.public_url", "player.url"}
LIST_KEYS = {"player.origins", "player.app_links", "network.home"}
MAX_ENTRIES = 64
SETTINGS = dict(SETTING_DEFAULTS)
BOOTED = dict(SETTING_DEFAULTS)
ENGINE_SECRET = {"created_at": None}
FAIL = {"mode": "off"}
CACHE = {"size": 3_200_000_000}
SCANS = {}
SCAN = {"finished": 0, "last": None}
SCAN_SECONDS = {"movies": 16, "series": 24}
BASE_TIME = shown_now()


def valid_url(value):
    if not isinstance(value, str):
        return False
    if value == "":
        return True
    u = urllib.parse.urlsplit(value)
    return (
        len(value) <= 300
        and u.scheme in ("http", "https")
        and bool(u.netloc)
        and "@" not in u.netloc
        and not u.query
        and not u.fragment
    )


def valid_entry(key, entry):
    if not isinstance(entry, str) or len(entry) > 300:
        return False
    if key == "player.origins":
        u = urllib.parse.urlsplit(entry)
        return (
            u.scheme in ("http", "https") and bool(u.netloc) and entry == f"{u.scheme}://{u.netloc}"
        )
    if key == "player.app_links":
        u = urllib.parse.urlsplit(entry)
        return bool(u.scheme) and bool(u.netloc or u.path) and not u.fragment
    try:
        ipaddress.ip_network(entry, strict=False)
    except ValueError:
        return False
    return True


def valid_setting(key, value):
    if key == "transcoding.hw_accel":
        return isinstance(value, str) and value in {"auto", "none", "vaapi"}
    if key == "stream.tonemap":
        return isinstance(value, bool)
    if key == "stream.max_live":
        return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 8
    if key == "transcoding.hw_device":
        return isinstance(value, str) and 0 < len(value) <= 200
    if key in URL_KEYS:
        return valid_url(value)
    if key in LIST_KEYS:
        return (
            isinstance(value, list)
            and len(value) <= MAX_ENTRIES
            and all(valid_entry(key, e) for e in value)
        )
    return False


def engine_up():
    return not (RESTART["admin"] and time.monotonic() < RESTART["until"])


def settle_restart():
    """The engine comes back once the restart window ends; it then reads the config it was saved with."""
    if RESTART["admin"] and time.monotonic() >= RESTART["until"]:
        RESTART["admin"] = False
        BOOTED.update(SETTINGS)


def settings_view():
    settle_restart()
    values = {k: v for k, v in SETTINGS.items() if k not in ENGINE_KEYS or engine_up()}
    forwarded = set()
    engine_read_only = args.read_only == "engine"
    reachable = engine_up()
    if args.engine_settings and reachable:
        st, e = engine("GET", "/v1/settings")
        reachable = st == 200
        if reachable:
            engine_read_only = engine_read_only or e["read_only"]
            for key, name in ENGINE_KEYS.items():
                values[key] = e["values"][name]
                if name in e["pending"]:
                    forwarded.add(key)
        else:
            values = {k: v for k, v in values.items() if k not in ENGINE_KEYS}
    pending = [
        k
        for k in RESTART_KEYS
        if reachable and (k in forwarded if args.engine_settings else SETTINGS[k] != BOOTED[k])
    ]
    return {
        "values": values,
        "owners": {k: "engine" if k in ENGINE_KEYS else "player" for k in SETTING_DEFAULTS},
        "read_only": {"engine": engine_read_only, "player": False},
        "pending": pending,
        "restart_keys": RESTART_KEYS if reachable else [],
    }


def patch_settings(patch):
    """(status, body); nothing changes unless every key is accepted."""
    if not isinstance(patch, dict):
        return 400, {"error": {"code": "invalid_setting"}}
    for key, value in patch.items():
        if key not in SETTING_DEFAULTS or not valid_setting(key, value):
            return 400, {"error": {"code": "invalid_setting", "key": key}}
    engine_part = {ENGINE_KEYS[k]: v for k, v in patch.items() if k in ENGINE_KEYS}
    if engine_part:
        if not engine_up():
            return 503, {"error": {"code": "engine_unavailable"}}
        if args.read_only == "engine":
            return 409, {"error": {"code": "read_only", "owner": "engine"}}
    if FAIL["mode"] == "save":
        return 500, {"error": {"code": "internal"}}
    if args.engine_settings and engine_part:
        st, _ = engine("PATCH", "/v1/settings", engine_part)
        if st == 409:
            return 409, {"error": {"code": "read_only", "owner": "engine"}}
        if st == 400:
            return 400, {
                "error": {
                    "code": "invalid_setting",
                    "key": next(k for k in patch if k in ENGINE_KEYS),
                }
            }
        if st != 200:
            return 503, {"error": {"code": "engine_unavailable"}}
    for key, value in patch.items():
        if not (args.engine_settings and key in ENGINE_KEYS):
            SETTINGS[key] = value
    return 200, settings_view()


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.UTC).isoformat()


DEMO_STREAMS = [
    {
        "id": "s1",
        "user": {"name": "Antoine Langlois", "you": True},
        "title": {"kind": "series", "id": 1},
        "season": 2,
        "episode": 4,
        "device": {"name": "Living room · SHIELD", "kind": "tv"},
        "network": "home",
        "position": 31 * 60 + 12,
        "playing": True,
        "mode": "copy",
        "video": "HEVC Main10 Dolby Vision",
        "audio": "EAC3 Atmos 5.1",
        "bitrate": 15_800_000,
    },
    {
        "id": "s2",
        "user": {"name": "Camille Roux", "you": False},
        "title": {"kind": "movies", "id": 1},
        "device": {"name": "Chrome on Linux", "kind": "browser"},
        "network": "remote",
        "position": 72 * 60 + 44,
        "playing": True,
        "mode": "transcode",
        "from": "HEVC Main10 HDR10",
        "to": "H.264 1080p SDR",
        "hw": "VAAPI",
        "speed": 2.1,
        "cannot_decode": "HEVC",
        "bitrate": 8_000_000,
    },
    {
        "id": "s3",
        "user": {"name": "Hugo Bernard", "you": False},
        "title": {"kind": "series", "id": 4},
        "season": 2,
        "episode": 2,
        "device": {"name": "Galaxy Tab S9", "kind": "tablet"},
        "network": "home",
        "position": 20 * 60 + 5,
        "playing": False,
        "mode": "audio",
        "from": "EAC3 5.1",
        "to": "AAC 5.1",
        "cannot_decode": "EAC3",
        "bitrate": 6_100_000,
    },
]
DEMO_PAIRING = {
    "user_code": "R4W-X9P",
    "expires": time.monotonic() + PAIR_TTL - 120,
    "status": "pending",
    "client_id": "demo-ipad",
    "name": "iPad mini",
    "platform": "iPadOS",
    "ip": "192.168.1.42",
    "requested_at": datetime.datetime.fromtimestamp(shown_now() - 120, datetime.UTC).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    ),
}
DAY = 86400
DEMO_APPS = [
    {
        "id": "d1",
        "name": "Antoine’s MacBook Pro",
        "platform": "macOS",
        "user": "Antoine Langlois",
        "key_store": "macOS Keychain",
        "seen": 0,
    },
    {
        "id": "d2",
        "name": "Living room · SHIELD",
        "platform": "Android TV",
        "user": "Antoine Langlois",
        "key_store": "Android Keystore",
        "seen": 0,
        "streaming": True,
    },
    {
        "id": "d3",
        "name": "iPhone 16 Pro",
        "platform": "iOS",
        "user": "Antoine Langlois",
        "key_store": "iOS Keychain",
        "seen": 22 * 3600,
        "location": "Lyon",
    },
    {
        "id": "d4",
        "name": "Galaxy Tab S9",
        "platform": "Android",
        "user": "Hugo Bernard",
        "key_store": "Android Keystore",
        "seen": 0,
        "streaming": True,
    },
    {
        "id": "d5",
        "name": "Pixel 9",
        "platform": "Android",
        "user": "Camille Roux",
        "key_store": "Android Keystore",
        "seen": 3 * DAY,
    },
]
DEMO_BROWSERS = [
    {
        "id": "w1",
        "name": "Chrome on Linux",
        "platform": "Web browser",
        "user": "Camille Roux",
        "seen": 0,
        "streaming": True,
        "expires": 6 * DAY,
    },
    {
        "id": "w2",
        "name": "Safari on macOS",
        "platform": "Web browser",
        "user": "Hugo Bernard",
        "seen": 5 * DAY,
        "expires": 2 * DAY,
    },
]
if args.demo_admin:
    PAIRINGS["demo-ipad-code"] = DEMO_PAIRING


def title_of(ref):
    return next(
        (t for t in (MOVIES if ref["kind"] == "movies" else SERIES) if t["id"] == ref["id"]), None
    )


def duration_of(stream):
    title = title_of(stream["title"])
    if title is None:
        return 0
    if stream["title"]["kind"] == "movies":
        return title["runtime"] * 60
    season = next(s for s in title["seasons"] if s["number"] == stream["season"])
    return next(e for e in season["episodes"] if e["number"] == stream["episode"])["runtime"] * 60


def stream_item(stream):
    duration = duration_of(stream)
    elapsed = shown_now() - BASE_TIME if stream["playing"] else 0
    return {**stream, "position": min(duration, stream["position"] + elapsed), "duration": duration}


ENGINE_MODE = {
    "direct": "copy",
    "remux": "copy",
    "audio_transcode": "audio",
    "transcode": "transcode",
}


def live_streams():
    if not LAST_BEAT:
        return []
    try:
        st, resp = engine("GET", "/v1/sessions")
        infos = {i["session_id"]: i for i in resp["sessions"]} if st == 200 else {}
    except OSError:
        infos = {}
    items = []
    for sid in list(LAST_BEAT):
        ref = REFS.get(SESSIONS.get(sid), {})
        watch = WATCH.get(SESSIONS.get(sid), {})
        if "movie_id" in ref:
            title, season, episode = {"kind": "movies", "id": ref["movie_id"]}, None, None
        elif "series_id" in ref:
            show = next(s for s in SERIES if s["id"] == ref["series_id"])
            number = next(
                e["number"]
                for s in show["seasons"]
                for e in s["episodes"]
                if e["id"] == ref["episode_id"]
            )
            title, season, episode = (
                {"kind": "series", "id": ref["series_id"]},
                ref["season"],
                number,
            )
        else:
            continue
        info = infos.get(sid, {})
        mode = ENGINE_MODE.get(info.get("mode"), "copy")
        item = {
            "id": sid,
            "user": {"name": ME["name"], "you": True},
            "title": title,
            "device": {"name": "This device", "kind": "desktop"},
            "network": "home" if args.network == "home" else "remote",
            "position": watch.get("position_seconds", 0),
            "duration": 0,
            "playing": True,
            "mode": mode,
            "bitrate": info.get("bitrate") or 0,
        }
        if season:
            item.update(season=season, episode=episode)
        video, audio = info.get("video", {}), info.get("audio", {})
        if mode == "copy":
            item.update(video=video.get("codec", ""), audio=audio.get("codec", ""))
        else:
            item.update(
                to=video.get("codec", "") if mode == "transcode" else audio.get("codec", "")
            )
        if mode == "transcode":
            item.update(
                hw=info.get("hw") or "software",
                **({"speed": info["speed"]} if info.get("speed") else {}),
            )
        item["duration"] = duration_of(item)
        items.append(item)
    return items


def admin_streams():
    return [stream_item(s) for s in DEMO_STREAMS] if args.demo_admin else live_streams()


def admin_pairings():
    now = time.monotonic()
    items = []
    for p in PAIRINGS.values():
        if p["status"] != "pending" or now > p["expires"]:
            continue
        created = datetime.datetime.strptime(p["requested_at"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.UTC
        )
        items.append(
            {
                "user_code": p["user_code"],
                "name": p["name"],
                "platform": p["platform"],
                "created_at": created.isoformat(),
                "expires_at": (created + datetime.timedelta(seconds=PAIR_TTL)).isoformat(),
            }
        )
    return items


def library_view():
    tick_scans()
    if args.demo_admin:
        folders = [
            {
                "id": "movies",
                "name": "Movies",
                "path": "/media/movies",
                "kind": "movies",
                "count": 42,
                "size": 1_300_000_000_000,
            },
            {
                "id": "series",
                "name": "Series",
                "path": "/media/series",
                "kind": "series",
                "count": 28,
                "size": 2_200_000_000_000,
            },
        ]
        last = SCAN["last"] or {
            "at": iso(shown_now() - (6 * DAY + 9 * 3600)),
            "added": 4,
            "replaced": 2,
            "errors": 0,
        }
    else:
        sized = lambda items: sum(i.get("file_summary", {}).get("size", 0) for i in items)
        folders = [
            {
                "id": "movies",
                "name": "Movies",
                "path": "/media/movies",
                "kind": "movies",
                "count": len(MOVIES),
                "size": sized(MOVIES),
            },
            {
                "id": "series",
                "name": "Series",
                "path": "/media/series",
                "kind": "series",
                "count": len(SERIES),
                "size": sized(SERIES),
            },
        ]
        last = SCAN["last"]
    now = time.monotonic()
    for folder in folders:
        scan = SCANS.get(folder["id"])
        if scan:
            left = scan["dur"] - (now - scan["t0"])
            folder["scan"] = {
                "progress": round(max(0.0, 1 - left / scan["dur"]), 3),
                "eta_seconds": math.ceil(left),
            }
    return {"folders": folders, **({"last_scan": last} if last else {})}


def tick_scans():
    now = time.monotonic()
    for folder, scan in list(SCANS.items()):
        if now - scan["t0"] >= scan["dur"]:
            del SCANS[folder]
            SCAN["finished"] += 1
    if SCAN["finished"] and not SCANS:
        SCAN["last"] = {"at": stamp(), "added": SCAN["finished"], "replaced": 0, "errors": 0}
        SCAN["finished"] = 0


def overview(host):
    streams = admin_streams()
    settle_restart()
    out = {
        "extension": {"version": "0.1.0"},
        "folders": {"reachable": 2, "total": 2},
        "streamline_url": f"http://{host}",
    }
    if not engine_up():
        return {**out, "engine": {"reachable": False}, "storage": {}}
    hw_off = settings_view()["values"].get("transcoding.hw_accel") == "none"
    return {
        **out,
        "engine": {
            "reachable": True,
            "version": "0.4.2",
            "api_version": 1,
            "ffmpeg_version": "7.1",
            "analysis_version": 1,
            "hw": {"mode": "software" if hw_off else "vaapi", "ready": True},
            "libplacebo": True,
            "dovi_tool": True,
        },
        "storage": {
            "cache": {"size": CACHE["size"], "streams": len(streams) if CACHE["size"] else 0}
        },
    }


def device_order(items):
    """The caller's own device, then those streaming, then the most recently used."""
    return sorted(
        items,
        key=lambda d: (not d["current"], not d["streaming"], [-ord(c) for c in d["last_seen"]]),
    )


def admin_device_items(headers):
    caller_browser = bearer_device(headers)
    now = shown_now()
    ago = lambda s: iso(now - s)
    me = KEYS.get(headers.get("X-API-Key"), {"name": "Living room", "platform": "android-tv"})
    if not args.demo_admin:
        return [{**d, "user": {"name": ME["name"]}} for d in device_items(headers)]
    if caller_browser:
        b = BROWSERS[caller_browser]
        caller = {
            "id": caller_browser,
            "kind": "browser",
            "name": b["name"],
            "platform": "Web browser",
            "last_seen": ago(0),
            "streaming": False,
            "current": True,
            "user": {"name": ME["name"]},
            "expires_at": iso(b["expires"]),
        }
    else:
        caller = {
            "id": "dev-self",
            "kind": "app",
            "name": me["name"] if headers.get("X-API-Key") in KEYS else "Desktop · app",
            "platform": "Linux",
            "last_seen": ago(0),
            "streaming": False,
            "current": True,
            "user": {"name": ME["name"]},
            "key_store": "Secret Service",
        }
    apps = [
        {
            "id": d["id"],
            "kind": "app",
            "name": d["name"],
            "platform": d["platform"],
            "last_seen": ago(d["seen"]),
            "streaming": d.get("streaming", False),
            "current": False,
            "user": {"name": d["user"]},
            "key_store": d["key_store"],
            **({"location": d["location"]} if "location" in d else {}),
        }
        for d in DEMO_APPS
    ]
    browsers = [
        {
            "id": d["id"],
            "kind": "browser",
            "name": d["name"],
            "platform": d["platform"],
            "last_seen": ago(d["seen"]),
            "streaming": d.get("streaming", False),
            "current": False,
            "user": {"name": d["user"]},
            "expires_at": ago(-d["expires"]),
        }
        for d in DEMO_BROWSERS
    ]
    return device_order([caller, *apps, *browsers])


def device_items(headers):
    now = shown_now()
    ago = lambda s: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - s))
    me = KEYS.get(headers.get("X-API-Key"), {"name": "Living room", "platform": "android-tv"})
    caller = bearer_device(headers)
    browsers = [
        {
            "id": i,
            "kind": "browser",
            "name": b["name"],
            "platform": "Web browser",
            "last_seen": ago(0),
            "streaming": False,
            "current": i == caller,
            "expires_at": datetime.datetime.fromtimestamp(b["expires"], datetime.UTC).isoformat(),
        }
        for i, b in BROWSERS.items()
    ]
    return device_order(
        [
            {
                "id": "dev-self",
                "kind": "app",
                "name": me["name"],
                "platform": me["platform"],
                "last_seen": ago(0),
                "streaming": False,
                "current": caller is None,
            },
            {
                "id": "dev-phone",
                "kind": "app",
                "name": "Pixel 9",
                "platform": "Android",
                "last_seen": ago(120),
                "streaming": True,
                "current": False,
            },
            {
                "id": "dev-laptop",
                "kind": "app",
                "name": "framework-13",
                "platform": "Linux",
                "last_seen": ago(3 * 86400),
                "streaming": False,
                "current": False,
            },
            {
                "id": "dev-parents",
                "kind": "app",
                "name": "Parents' TV",
                "platform": "Android TV",
                "last_seen": ago(9 * 86400),
                "streaming": False,
                "current": False,
            },
            *browsers,
        ]
    )


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin in CORS_ORIGINS and self.path.startswith("/extensions/player"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Expose-Headers", "Content-Disposition")
            if self.command == "OPTIONS":
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
        super().end_headers()

    def do_OPTIONS(self):
        self.reply(204)

    def reply(self, status, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def image(self, data, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def refused(self):
        if self.path.startswith("/extensions/player/auth/"):
            return False
        if self.headers.get("Authorization") is not None:
            if bearer_device(self.headers) is not None:
                return False
            self.reply(401, {"error": {"code": "unauthorized"}})
            return True
        key = self.headers.get("X-API-Key")
        if key is None or key in KEYS:
            return False
        self.reply(401, {"error": {"code": "unauthorized"}})
        return True

    def authorize(self, q):
        """Streamline's sign-in page: send the browser back to its redirect_uri with a one-time code, or the denial.
        A web player's origin must be on the allow-list; an app comes back to a loopback port (RFC 8252)."""
        one = lambda name: q.get(name, [""])[0]
        target = urllib.parse.urlsplit(one("redirect_uri"))
        origin = f"{target.scheme}://{target.netloc}"
        loopback = target.scheme == "http" and target.hostname == "127.0.0.1" and target.port
        if (
            not (origin in CORS_ORIGINS or loopback)
            or one("code_challenge_method") != "S256"
            or not one("code_challenge")
        ):
            return self.reply(400, {"error": {"code": "invalid_request"}})
        if args.sso_deny:
            params = {"error": "access_denied", "state": one("state")}
        else:
            code = secrets.token_urlsafe(32)
            CODES[code] = {"challenge": one("code_challenge"), "redirect_uri": one("redirect_uri")}
            params = {"code": code, "state": one("state")}
        self.send_response(302)
        self.send_header("Location", f"{one('redirect_uri')}?{urllib.parse.urlencode(params)}")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return None

    def token(self):
        b = self.body()
        invalid = lambda: self.reply(400, {"error": {"code": "invalid_grant"}})
        grant = b.get("grant_type")
        if grant == "authorization_code":
            found = CODES.pop(b.get("code", ""), None)
            if (
                not found
                or found["redirect_uri"] != b.get("redirect_uri")
                or not pkce_matches(b.get("code_verifier", ""), found["challenge"])
            ):
                return invalid()
            if b.get("client_id"):
                return self.reply(200, new_key(b))
            return self.reply(200, new_browser(b.get("device_name", "")))
        if grant == "refresh_token":
            token = b.get("refresh_token", "")
            device_id = REFRESH.get(token)
            device = BROWSERS.get(device_id)
            if device is None:
                return invalid()
            if device["refresh"] != token:
                revoke_browser(device_id)
                return invalid()
            if time.time() > device["expires"]:
                return invalid()
            return self.reply(200, issue_tokens(device_id))
        return self.reply(400, {"error": {"code": "unsupported_grant_type"}})

    def pairing(self, code):
        """The pairing a /dev route names, or the newest one still waiting."""
        waiting = [
            p
            for p in PAIRINGS.values()
            if p["status"] == "pending" and (code is None or p["user_code"] == code)
        ]
        return max(waiting, key=lambda p: p["expires"], default=None)

    def approver_pairing(self, code):
        """The pending pairing a browser's approval call names, or None once the reply (401, 403 or 404) is sent."""
        if bearer_device(self.headers) is None:
            if self.headers.get("X-API-Key") in KEYS:
                self.reply(403, {"error": {"code": "session_required"}})
            else:
                self.reply(401, {"error": {"code": "unauthorized"}})
            return None
        wanted = code.replace("-", "").upper()
        now = time.monotonic()
        for p in PAIRINGS.values():
            if (
                p["status"] == "pending"
                and now <= p["expires"]
                and p["user_code"].replace("-", "") == wanted
            ):
                return p
        self.reply(404, {"error": {"code": "no_pending_pairing"}})
        return None

    def admin(self, method):
        """Server settings: /extensions/player/admin/*, for an admin only."""
        if ME["role"] != "Admin":
            return self.reply(403, {"error": {"code": "forbidden"}})
        url = urllib.parse.urlsplit(self.path)
        try:
            return self.admin_route(
                method,
                url.path[len("/extensions/player/admin") :],
                urllib.parse.parse_qs(url.query),
            )
        except OSError:
            return self.reply(503, {"error": {"code": "engine_unavailable"}})

    def admin_route(self, method, path, query):
        not_found = lambda: self.reply(404, {"error": {"code": "not_found"}})
        failing = lambda: FAIL["mode"] == "action" and method != "GET"
        if method == "GET":
            if path == "/overview":
                return self.reply(200, overview(self.headers["Host"]))
            if path == "/settings":
                return self.reply(200, settings_view())
            if path == "/streams":
                return self.reply(200, {"items": admin_streams()})
            if path == "/pairings":
                return self.reply(200, {"items": admin_pairings()})
            if path == "/devices":
                return self.reply(200, {"items": admin_device_items(self.headers)})
            if path == "/library":
                return self.reply(200, library_view())
            if path == "/users":
                return self.reply(200, {"items": sorted(USERS, key=lambda u: u["name"])})
            if path == "/engine/secret":
                made = ENGINE_SECRET["created_at"]
                return self.reply(
                    200, {"set": True, "created_at": iso(made)} if made else {"set": False}
                )
            return not_found()
        if method == "PATCH" and path == "/settings":
            status, body = patch_settings(self.body())
            return self.reply(status, body)
        if failing():
            return self.reply(500, {"error": {"code": "internal"}})
        if method == "POST" and path == "/engine/secret":
            ENGINE_SECRET["created_at"] = shown_now()
            return self.reply(200, {"secret": secrets.token_urlsafe(32)})
        if method == "POST" and path == "/restart":
            if not engine_up():
                return self.reply(503, {"error": {"code": "engine_unavailable"}})
            message = self.body().get("message", "")
            if not isinstance(message, str) or len(message) > 200:
                return self.reply(400, {"error": {"code": "invalid_request"}})
            if args.engine_settings:
                try:
                    engine("POST", "/v1/restart")
                except OSError:
                    pass
            RESTART.update(
                until=math.inf if args.restart_hangs else time.monotonic() + 10, message=message
            )
            RESTART["admin"] = True
            return self.reply(202)
        m = re.fullmatch(r"/pairings/([A-Za-z0-9-]+)/(approve|deny)", path)
        if method == "POST" and m:
            if failing():
                return self.reply(500, {"error": {"code": "internal"}})
            if m[2] == "approve":
                user_id = self.body().get("user_id")
                if not isinstance(user_id, int) or isinstance(user_id, bool):
                    return self.reply(
                        400,
                        {"error": {"code": "invalid_request", "message": "user_id is required"}},
                    )
                if not any(u["id"] == user_id for u in USERS):
                    return self.reply(
                        404, {"error": {"code": "not_found", "message": "No such user"}}
                    )
            wanted = m[1].replace("-", "").upper()
            now = time.monotonic()
            for p in PAIRINGS.values():
                if (
                    p["status"] == "pending"
                    and now <= p["expires"]
                    and p["user_code"].replace("-", "") == wanted
                ):
                    p["status"] = "approved" if m[2] == "approve" else "denied"
                    return self.reply(204)
            return self.reply(404, {"error": {"code": "no_pending_pairing"}})
        m = re.fullmatch(r"/streams/([\w-]+)/stop", path)
        if method == "POST" and m:
            message = self.body().get("message", "")
            if not isinstance(message, str) or len(message) > 200:
                return self.reply(400, {"error": {"code": "invalid_request"}})
            if args.demo_admin:
                kept = [s for s in DEMO_STREAMS if s["id"] != m[1]]
                if len(kept) == len(DEMO_STREAMS):
                    return not_found()
                DEMO_STREAMS[:] = kept
            else:
                if m[1] not in LAST_BEAT:
                    return not_found()
                STOPPED[m[1]] = message
                LAST_BEAT.pop(m[1], None)
            return self.reply(204)
        m = re.fullmatch(r"/devices/([\w-]+)", path)
        if method == "DELETE" and m:
            if m[1] == (bearer_device(self.headers) or "dev-self"):
                return self.reply(409, {"error": {"code": "current_device"}})
            if args.demo_admin:
                for group in (DEMO_APPS, DEMO_BROWSERS):
                    if any(d["id"] == m[1] for d in group):
                        group[:] = [d for d in group if d["id"] != m[1]]
                        return self.reply(204)
                return not_found()
            if revoke_browser(m[1]) or m[1] in ("dev-phone", "dev-laptop", "dev-parents"):
                return self.reply(204)
            return not_found()
        if method == "POST" and path == "/library/scan":
            body = self.body()
            if body.get("movies") or body.get("episodes"):
                return self.reply(202)
            folder = body.get("folder_id")
            known = ("movies", "series")
            if folder is not None and folder not in known:
                return not_found()
            tick_scans()
            for name in [folder] if folder else known:
                SCANS.setdefault(name, {"t0": time.monotonic(), "dur": SCAN_SECONDS[name]})
            return self.reply(202)
        if method == "POST" and path == "/cache/clear":
            if not engine_up():
                return self.reply(503, {"error": {"code": "engine_unavailable"}})
            freed, CACHE["size"] = CACHE["size"], 0
            return self.reply(200, {"freed": freed})
        return not_found()

    def do_GET(self):
        if self.refused():
            return
        if self.path.startswith("/extensions/player/admin/"):
            return self.admin("GET")
        if self.path.startswith("/extensions/player/downloads"):
            return self.downloads("GET")
        m = re.fullmatch(r"/extensions/player/auth/device/([A-Za-z0-9-]+)", self.path)
        if m and m[1] not in ("code", "token"):
            found = self.approver_pairing(m[1])
            if found is None:
                return None
            return self.reply(
                200,
                {
                    "user_code": found["user_code"],
                    "name": found["name"],
                    "platform": found["platform"],
                    "requested_at": found["requested_at"],
                    "ip": found["ip"],
                },
            )
        if self.path == "/health":
            return self.reply(200, {"status": "ok"})
        if self.path == "/extensions/player/movies":
            return self.reply(200, {"items": [summary(m) for m in MOVIES], "total": len(MOVIES)})
        if self.path == "/extensions/player/series":
            return self.reply(
                200, {"items": [series_summary(s) for s in SERIES], "total": len(SERIES)}
            )
        m = re.fullmatch(r"/extensions/player/(movies|series)/(\d+)", self.path)
        if m:
            found = next(
                (i for i in (MOVIES if m[1] == "movies" else SERIES) if str(i["id"]) == m[2]), None
            )
            return (
                self.reply(200, found)
                if found
                else self.reply(404, {"error": {"code": "not_found"}})
            )
        if self.path == "/extensions/player/watchstate":
            return self.reply(
                200, {"items": sorted(WATCH.values(), key=lambda w: w["updated_at"], reverse=True)}
            )
        m = re.fullmatch(r"/extensions/player/people/([a-z0-9-]+)", self.path)
        if m:
            found = person(m[1])
            return (
                self.reply(200, found)
                if found
                else self.reply(404, {"error": {"code": "not_found"}})
            )
        if self.path == "/extensions/player/home":
            return self.reply(200, home())
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/extensions/player/posters/users/me/photo.jpg":
            if self.headers.get("Authorization") is None and self.headers.get("X-API-Key") is None:
                return self.reply(401, {"error": {"code": "unauthorized"}})
            if PICTURE["data"] is None:
                return self.reply(404, {"error": {"code": "not_found"}})
            return self.image(PICTURE["data"], PICTURE["type"])
        m = re.fullmatch(
            r"/extensions/player/posters/(movies|series|people)/([\w-]+)/(poster|poster-w342|backdrop|photo)\.jpg",
            self.path,
        )
        if m:
            if not ART_ON["on"] or (m[1] == "people") != (m[3] == "photo"):
                path = None
            elif m[1] == "people":
                path = os.path.join(args.art, "c", f"{m[2]}.jpg")
                path = path if os.path.exists(path) else None
            else:
                path = art(m[1], m[2], m[3])
            if not path:
                return self.reply(404, {"error": {"code": "not_found"}})
            with open(path, "rb") as image:
                return self.image(image.read(), "image/jpeg")
        if self.path == "/extensions/player/playback/status":
            st, _ = engine("GET", "/v1/health")
            return self.reply(
                200, {"available": st == 200, "media": sorted(MEDIA), "network": args.network}
            )
        if url.path == "/extensions/player/auth/methods":
            return self.reply(200, {"register_url": None})
        if url.path == "/extensions/player/authorize":
            return self.authorize(urllib.parse.parse_qs(url.query))
        if self.path == "/extensions/player/me":
            return self.reply(200, profile(self.headers["Host"]))
        if self.path == "/extensions/player/activity":
            me = self.headers.get("X-API-Key") or ""
            return self.reply(
                200,
                {
                    "items": [
                        {k: v for k, v in e.items() if k != "_device"}
                        for e in ACTIVITY
                        if e.get("_device", me) == me
                    ][:100]
                },
            )
        if self.path == "/extensions/player/devices":
            return self.reply(200, {"items": device_items(self.headers)})
        m = re.fullmatch(r"/extensions/player/playback/media/([^/]+)/tracks", self.path)
        if m and m[1] in MEDIA:
            return self.reply(200, tracks(m[1], MEDIA[m[1]]))
        m = re.fullmatch(r"/extensions/player/playback/sessions/([0-9a-f]{32})", self.path)
        if m:
            _, resp = engine("GET", "/v1/sessions")
            found = next((i for i in resp["sessions"] if i["session_id"] == m[1]), None)
            return (
                self.reply(200, found)
                if found
                else self.reply(404, {"error": {"code": "not_found"}})
            )
        self.reply(404, {"error": {"code": "not_found"}})

    def do_POST(self):
        if self.refused():
            return
        if self.path.startswith("/extensions/player/admin/"):
            return self.admin("POST")
        if self.path.startswith("/extensions/player/downloads"):
            return self.downloads("POST")
        # Dev only: what an admin does from Streamline's web app. Both answer the next heartbeat.
        m = re.fullmatch(r"/dev/stop(?:/([0-9a-f]{32}))?", self.path)
        if m:
            message = self.body().get("message", "")
            for sid in [m[1]] if m[1] else list(LAST_BEAT):
                STOPPED[sid] = message
                LAST_BEAT.pop(sid, None)
                engine("DELETE", f"/v1/sessions/{sid}")
            return self.reply(204)
        m = re.fullmatch(
            r"/extensions/player/auth/device/([A-Za-z0-9-]+)/(approve|deny)", self.path
        )
        if m:
            found = self.approver_pairing(m[1])
            if found is None:
                return None
            found["status"] = "approved" if m[2] == "approve" else "denied"
            return self.reply(204)
        m = re.fullmatch(r"/dev/(approve|deny)(?:/([A-Z0-9-]+))?", self.path)
        if m:
            found = self.pairing(m[2])
            if not found:
                return self.reply(404, {"error": {"code": "no_pending_pairing"}})
            found["status"] = "approved" if m[1] == "approve" else "denied"
            return self.reply(200, {"user_code": found["user_code"], "name": found["name"]})
        m = re.fullmatch(r"/dev/role/(admin|member)", self.path)
        if m:
            ME["role"] = m[1].capitalize()
            return self.reply(204)
        m = re.fullmatch(r"/dev/admin/fail/(save|action|off)", self.path)
        if m:
            FAIL["mode"] = m[1]
            return self.reply(204)
        m = re.fullmatch(r"/dev/admin/read-only/(engine|off)", self.path)
        if m:
            args.read_only = None if m[1] == "off" else m[1]
            return self.reply(204)
        if self.path == "/dev/admin/streams/clear":
            DEMO_STREAMS.clear()
            return self.reply(204)
        if self.path == "/dev/admin/pairing":
            PAIRINGS["demo-ipad-code"] = {
                **DEMO_PAIRING,
                "status": "pending",
                "expires": time.monotonic() + PAIR_TTL - 120,
            }
            return self.reply(204)
        if self.path == "/dev/admin/pairing/expire":
            for pairing in PAIRINGS.values():
                pairing["expires"] = time.monotonic() - 1
            return self.reply(204)
        if self.path == "/dev/admin/restart/finish":
            RESTART["until"] = 0.0
            return self.reply(204)
        if self.path == "/dev/admin/player-url/off":
            SETTINGS["player.url"] = ""
            return self.reply(204)
        m = re.fullmatch(r"/dev/admin/restart-hangs/(on|off)", self.path)
        if m:
            args.restart_hangs = m[1] == "on"
            return self.reply(204)
        if self.path == "/dev/admin/scan/finish":
            for scan in SCANS.values():
                scan["t0"] -= scan["dur"]
            tick_scans()
            return self.reply(204)
        if self.path == "/dev/downloads/fail":
            DOWNLOAD_FAIL["next"] = True
            return self.reply(204)
        if self.path == "/dev/activity/unread":
            for event in ACTIVITY:
                event["read"] = False
            return self.reply(204)
        if self.path == "/extensions/player/activity/read":
            ids = self.body().get("ids")
            if (
                not isinstance(ids, list)
                or not 1 <= len(ids) <= 100
                or not all(isinstance(i, str) for i in ids)
            ):
                return self.reply(400, {"error": {"code": "invalid_request"}})
            for event in ACTIVITY:
                if event["id"] in ids:
                    event["read"] = True
            return self.reply(204)
        m = re.fullmatch(r"/dev/art/(on|off)", self.path)
        if m:
            ART_ON["on"] = m[1] == "on"
            return self.reply(204)
        if self.path == "/dev/revoke":
            KEYS.clear()
            return self.reply(204)
        if self.path == "/extensions/player/auth/token":
            return self.token()
        if self.path == "/extensions/player/auth/device/code":
            b = self.body()
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
            code = f"{code[:3]}-{code[3:]}"
            device_code = secrets.token_urlsafe(32)
            PAIRINGS[device_code] = {
                "user_code": code,
                "expires": time.monotonic() + PAIR_TTL,
                "status": "pending",
                "client_id": b.get("client_id"),
                "name": b.get("name", "")[:64],
                "platform": b.get("platform", ""),
                "requested_at": datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "ip": self.client_address[0],
            }
            base = SETTINGS["player.url"] or f"http://{self.headers['Host']}"
            return self.reply(
                200,
                {
                    "device_code": device_code,
                    "user_code": code,
                    "verification_uri": f"{base}/pair",
                    "verification_uri_complete": f"{base}/pair?code={code}",
                    "expires_in": PAIR_TTL,
                    "interval": PAIR_INTERVAL,
                },
            )
        if self.path == "/extensions/player/auth/device/token":
            found = PAIRINGS.get(self.body().get("device_code", ""))
            if not found or time.monotonic() > found["expires"]:
                return self.reply(400, {"error": {"code": "expired_token"}})
            if found["status"] == "pending":
                return self.reply(400, {"error": {"code": "authorization_pending"}})
            if found["status"] == "denied":
                return self.reply(400, {"error": {"code": "access_denied"}})
            PAIRINGS.pop(next(d for d, p in PAIRINGS.items() if p is found))
            return self.reply(200, new_key(found))
        if self.path == "/dev/restart":
            b = self.body()
            RESTART.update(
                until=time.monotonic() + b.get("seconds", 10), message=b.get("message", "")
            )
            return self.reply(204)
        if time.monotonic() < RESTART["until"] and self.path.startswith(
            "/extensions/player/playback/sessions"
        ):
            left = (
                10
                if math.isinf(RESTART["until"])
                else max(1, round(RESTART["until"] - time.monotonic()))
            )
            return self.reply(
                503,
                {
                    "error": {
                        "code": "server_restarting",
                        "message": RESTART["message"],
                        "by": ADMIN,
                        "retry_after": left,
                    }
                },
            )
        if self.path == "/extensions/player/playback/decisions":
            b = self.body()
            path = MEDIA.get(b.pop("media_id", None))
            if path is None:
                return self.reply(
                    404, {"error": {"code": "media_not_found", "message": "no such media"}}
                )
            if path in ANALYSIS:
                b["analysis"] = ANALYSIS[path]
            st, resp = engine("POST", "/v1/decisions", {"path": path, **b})
            return self.reply(st, resp)
        if self.path == "/extensions/player/playback/sessions":
            b = self.body()
            media_id = b.pop("media_id", None)
            path = MEDIA.get(media_id)
            if path is None:
                return self.reply(404, {"error": {"code": "media_not_found"}})
            sid = secrets.token_hex(16)
            if path in ANALYSIS:
                b["analysis"] = ANALYSIS[path]
            SESSIONS[sid] = media_id
            st, resp = engine("POST", "/v1/sessions", {"session_id": sid, "path": path, **b})
            if st < 300:
                LAST_BEAT[sid] = time.monotonic()
            return self.reply(st, with_url(sid, resp) if st < 300 else resp)
        m = re.fullmatch(r"/extensions/player/playback/sessions/([0-9a-f]{32})/progress", self.path)
        if m:
            if m[1] in STOPPED:
                # An admin stop lets the player learn of it on this call; killing the engine session earlier makes it recover instead.
                try:
                    engine("DELETE", f"/v1/sessions/{m[1]}")
                except OSError:
                    pass
                return self.reply(
                    410,
                    {
                        "error": {
                            "code": "session_stopped",
                            "message": STOPPED.pop(m[1]),
                            "by": ADMIN,
                        }
                    },
                )
            if m[1] in LAST_BEAT:
                LAST_BEAT[m[1]] = time.monotonic()
            note_progress(m[1], self.body().get("position", 0))
            return self.reply(204)
        self.reply(404, {"error": {"code": "not_found"}})

    def do_PUT(self):
        if self.refused():
            return
        if self.path == "/extensions/player/me/picture":
            data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            kind = self.headers.get("Content-Type", "").split(";")[0].strip()
            if kind not in PICTURE_TYPES:
                return self.reply(415, {"error": {"code": "unsupported_type"}})
            if len(data) > PICTURE_MAX:
                return self.reply(
                    413, {"error": {"code": "too_large", "message": "The picture is over 512 KB."}}
                )
            PICTURE.update(data=data, type=kind)
            return self.reply(204)
        m = re.fullmatch(r"/extensions/player/watchstate/(.+)", self.path)
        if not m or m[1] not in MEDIA:
            return self.reply(404, {"error": {"code": "not_found"}})
        b = self.body()
        if "position_seconds" in b or "at" in b:
            return self.offline_progress(m[1], b)
        WATCH[m[1]] = {
            **REFS.get(m[1], {}),
            "media_id": m[1],
            "position_seconds": 0,
            "duration_seconds": 0,
            "watched": b.get("watched", False),
            "updated_at": stamp(),
        }
        self.reply(200, WATCH[m[1]])

    def offline_progress(self, media_id, b):
        """Progress a desktop app recorded from a download: kept only when newer than what the server holds."""
        position, duration, at = (
            b.get("position_seconds"),
            b.get("duration_seconds"),
            parse_time(b.get("at")),
        )
        ints = all(
            isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in (position, duration)
        )
        if not ints or at is None:
            return self.reply(400, {"error": {"code": "invalid_request"}})
        held = WATCH.get(media_id)
        if held is None or at > (parse_time(held["updated_at"]) or 0):
            WATCH[media_id] = {
                **REFS.get(media_id, {}),
                "media_id": media_id,
                "position_seconds": position,
                "duration_seconds": duration,
                "watched": duration > 0 and position >= WATCHED_AT * duration,
                "updated_at": datetime.datetime.fromtimestamp(at, datetime.UTC).isoformat(),
            }
        self.reply(200, WATCH[media_id])

    def downloads(self, method):
        """Downloads: /extensions/player/downloads/*, for an app's device key; a browser has none."""
        if bearer_device(self.headers) is not None:
            return self.reply(403, {"error": {"code": "forbidden"}})
        key = self.headers.get("X-API-Key")
        device = key or ""
        invalid = lambda: self.reply(400, {"error": {"code": "invalid_request"}})
        not_found = lambda: self.reply(404, {"error": {"code": "not_found"}})
        if self.path == "/extensions/player/downloads" and method == "POST":
            b = self.body()
            indexes, quality, caps = b.get("audio_indexes"), b.get("quality"), b.get("capabilities")
            if (
                not isinstance(b.get("media_id"), str)
                or quality not in DOWNLOAD_QUALITIES
                or not isinstance(caps, dict)
                or not isinstance(indexes, list)
                or not indexes
                or not all(isinstance(i, int) and not isinstance(i, bool) for i in indexes)
            ):
                return invalid()
            path = MEDIA.get(b["media_id"])
            if path is None:
                return not_found()
            if path in ANALYSIS and not all(
                i in {a["index"] for a in ANALYSIS[path].get("audio", [])} for i in indexes
            ):
                return invalid()
            if DOWNLOAD_FAIL["next"]:
                DOWNLOAD_FAIL["next"] = False
                entry = {
                    "id": secrets.token_hex(16),
                    "media_id": b["media_id"],
                    "device": device,
                    "failed": True,
                }
                DOWNLOADS[entry["id"]] = entry
                return self.reply(201, download_view(entry))
            seed = f"{job_id('download', path)}|{device}|{quality}|{sorted(set(indexes))}"
            entry = {
                "id": hashlib.md5(seed.encode()).hexdigest(),
                "media_id": b["media_id"],
                "device": device,
                "failed": False,
            }
            st, resp = engine(
                "POST",
                "/v1/jobs",
                {
                    "job_id": entry["id"],
                    "type": "download",
                    "priority": "background",
                    "path": path,
                    "capabilities": caps,
                    "audio_indexes": indexes,
                    **DOWNLOAD_QUALITIES[quality],
                },
            )
            if st == 429:
                return self.reply(429, {"error": {"code": "queue_full"}})
            if st >= 400 and (resp or {}).get("code") != "job_exists":
                print(f"download {b['media_id']}: {st} {resp}", flush=True)
                return (
                    invalid() if st == 400 else self.reply(502, {"error": {"code": "engine_error"}})
                )
            DOWNLOADS[entry["id"]] = entry
            return self.reply(201, download_view(entry))
        m = re.fullmatch(r"/extensions/player/downloads/([0-9a-f]{32})(/complete)?", self.path)
        if not m:
            return not_found()
        entry = DOWNLOADS.get(m[1])
        if method == "DELETE" and not m[2]:
            if entry is not None and entry["device"] == device:
                DOWNLOADS.pop(m[1])
                if not entry["failed"]:
                    engine("DELETE", f"/v1/jobs/{m[1]}")
            return self.reply(204)
        if entry is None or entry["device"] != device:
            return not_found()
        if method == "GET" and not m[2]:
            return self.reply(200, download_view(entry))
        if method == "POST" and m[2]:
            if download_view(entry)["state"] != "ready":
                return self.reply(409, {"error": {"code": "not_ready"}})
            DOWNLOADS.pop(m[1])
            engine("DELETE", f"/v1/jobs/{m[1]}")
            ACTIVITY.insert(
                0,
                download_event(
                    entry, KEYS.get(key, {"name": "Desktop · app", "platform": "Linux"})
                ),
            )
            return self.reply(204)
        return not_found()

    def do_PATCH(self):
        if self.refused():
            return
        if self.path.startswith("/extensions/player/admin/"):
            return self.admin("PATCH")
        m = re.fullmatch(r"/extensions/player/playback/sessions/([0-9a-f]{32})", self.path)
        if not m:
            return self.reply(404, {"error": {"code": "not_found"}})
        st, resp = engine("PATCH", f"/v1/sessions/{m[1]}", self.body())
        self.reply(st, with_url(m[1], resp) if st < 300 else resp)

    def do_DELETE(self):
        if self.refused():
            return
        if self.path.startswith("/extensions/player/admin/"):
            return self.admin("DELETE")
        if self.path.startswith("/extensions/player/downloads"):
            return self.downloads("DELETE")
        if self.path == "/extensions/player/me/picture":
            PICTURE.update(data=None, type="")
            return self.reply(204)
        if self.path == "/extensions/player/devices/current":
            caller = bearer_device(self.headers)
            if caller:
                revoke_browser(caller)
            else:
                KEYS.pop(self.headers.get("X-API-Key"), None)
            return self.reply(204)
        m = re.fullmatch(r"/extensions/player/devices/([\w-]+)", self.path)
        if m:
            if revoke_browser(m[1]) or m[1] in ("dev-phone", "dev-laptop", "dev-parents"):
                return self.reply(204)
            return self.reply(404, {"error": {"code": "not_found"}})
        m = re.fullmatch(r"/extensions/player/playback/sessions/([0-9a-f]{32})", self.path)
        if not m:
            return self.reply(404, {"error": {"code": "not_found"}})
        LAST_BEAT.pop(m[1], None)
        st, resp = engine("DELETE", f"/v1/sessions/{m[1]}")
        self.reply(st, resp)


def reap_silent():
    """Streamline stops a session whose client stopped heartbeating (a crash, a killed app)."""
    while True:
        time.sleep(5)
        cutoff = time.monotonic() - args.heartbeat_timeout
        for sid, beat in list(LAST_BEAT.items()):
            if beat < cutoff and LAST_BEAT.pop(sid, None) is not None:
                st, _ = engine("DELETE", f"/v1/sessions/{sid}")
                print(f"stopped silent session {sid}: engine {st}", flush=True)


host, port = args.listen.rsplit(":", 1)
server = ThreadingHTTPServer((host, int(port)), Handler)
print(f"listening on {host}:{server.server_address[1]}", flush=True)

threading.Thread(target=reap_silent, daemon=True).start()

for media_path in set(MEDIA.values()):
    threading.Thread(target=prepare, args=(media_path,), daemon=True).start()

for show in SERIES:
    for season in show["seasons"]:
        season_paths = sorted(
            {MEDIA[e["media_file_id"]] for e in season["episodes"] if e["media_file_id"] in MEDIA}
        )
        if not season_paths:
            break
        threading.Thread(target=prepare_season, args=(season_paths,), daemon=True).start()
        break
    break

print(f"mock streamline on {args.listen}, engine {args.engine}, media {sorted(MEDIA)}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
