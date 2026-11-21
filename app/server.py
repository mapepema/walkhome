"""FastAPI application: REST for state and history, WebSocket for the live feed.

One process owns everything -- the BLE central, the session state machine and
the fan-out -- so there is exactly one source of truth on the LAN.

Isolation rule: every private route lives under ``/api/me`` and is scoped by the
authenticated user; no route takes an arbitrary ``user_id`` to read private
data. Other players are only visible through public profiles and the
leaderboard.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .auth import COOKIE_NAME, LoginLimiter
from .ble import SimulatedTelemetrySource
from .cards import CRAFT_COST, DUP_ESSENCE
from .config import config
from .content import ContentLibrary
from .db import Database
from .errors import Forbidden, NotFound, Unauthorized, WalkhomeError
from .hub import Hub
from .rewards import ALBUM_TIERS, PODIUM_PACKS, STREAK_TIERS, WELCOME_PACKS
from .service import WalkhomeService

log = logging.getLogger(__name__)

COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


# --------------------------------------------------------------------------
# request bodies (Optional[...] rather than X | None: Python 3.9 compatible)
# --------------------------------------------------------------------------

class RegisterBody(BaseModel):
    username: str
    password: str = Field(max_length=256)
    journey_id: Optional[str] = None
    avatar: str = Field(default="🧝", max_length=32)
    color: str = Field(default="#8ecae6", pattern=COLOR_PATTERN)
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    invite_code: Optional[str] = None


class LoginBody(BaseModel):
    username: str
    password: str = Field(max_length=256)


class PatchMeBody(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    avatar: Optional[str] = Field(default=None, min_length=1, max_length=32)
    color: Optional[str] = Field(default=None, pattern=COLOR_PATTERN)
    daily_goal_m: Optional[float] = Field(default=None, ge=0, le=200_000)
    journey_id: Optional[str] = None
    units: Optional[str] = Field(default=None, pattern=r"^(km|mi)$")


class PasswordBody(BaseModel):
    old: str = Field(max_length=256)
    new: str = Field(max_length=256)


class StartWalkBody(BaseModel):
    journey_id: Optional[str] = None


class StopWalkBody(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class NoteBody(BaseModel):
    note: str = Field(max_length=500)


class ManualSessionBody(BaseModel):
    distance_m: float = Field(gt=0, le=200_000)
    minutes: float = Field(default=0.0, ge=0, le=24 * 60)
    note: str = Field(default="", max_length=500)
    when_utc: Optional[str] = None


class ChoiceBody(BaseModel):
    event_id: str
    option_id: str


class CraftBody(BaseModel):
    card_id: str


class ReadBody(BaseModel):
    ids: Optional[List[int]] = None
    all: bool = False


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeBody(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: PushKeys


class AdminPatchBody(BaseModel):
    handicap: Optional[float] = Field(default=None, gt=0, le=10)
    archived: Optional[int] = Field(default=None, ge=0, le=1)
    is_admin: Optional[int] = Field(default=None, ge=0, le=1)
    daily_goal_m: Optional[float] = Field(default=None, ge=0)


class AdjustmentBody(BaseModel):
    user_id: int
    delta_m: float = Field(ge=-200_000, le=200_000)
    reason: str = Field(default="", max_length=200)
    journey_id: Optional[str] = None


class SimBody(BaseModel):
    speed_kmh: Optional[float] = Field(default=None, ge=0, le=25)
    incline_pct: Optional[float] = Field(default=None, ge=0, le=20)
    drop_link_s: Optional[float] = Field(default=None, ge=0, le=600)
    reset_console: bool = False
    auto: Optional[bool] = None


# --------------------------------------------------------------------------
# app factory
# --------------------------------------------------------------------------

def create_app(cfg=config, service_factory=None) -> FastAPI:
    cfg.ensure_dirs()
    db = Database(cfg.db_path)
    library = ContentLibrary(cfg.content_dir)
    hub = Hub()
    service = (service_factory or WalkhomeService)(cfg, db, library, hub)
    auth = service.auth
    register_limiter = LoginLimiter(cfg.register_max_per_hour, 3600.0)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await service.start()
        try:
            yield
        finally:
            await service.stop()
            await hub.close()
            db.close()

    app = FastAPI(title="Walkhome", lifespan=lifespan)
    app.state.service = service
    app.state.db = db

    # -- errors --------------------------------------------------------------

    @app.exception_handler(WalkhomeError)
    async def walkhome_error(_request: Request, exc: WalkhomeError) -> JSONResponse:
        body: Dict[str, Any] = {"detail": exc.detail}
        if exc.code:
            body["code"] = exc.code
        headers = {}
        retry = getattr(exc, "retry_after_s", None)
        if retry:
            headers["Retry-After"] = str(retry)
        return JSONResponse(body, status_code=exc.status, headers=headers)

    @app.exception_handler(KeyError)
    async def key_error(_request: Request, exc: KeyError) -> JSONResponse:
        detail = str(exc.args[0]) if exc.args else "unknown key"
        return JSONResponse({"detail": detail}, status_code=400)

    # -- auth plumbing -------------------------------------------------------

    def token_from(headers, cookies) -> Optional[str]:
        authz = headers.get("authorization", "")
        if authz[:7].lower() == "bearer ":
            return authz[7:].strip() or None
        return cookies.get(COOKIE_NAME)

    def current_user(request: Request) -> dict:
        user = auth.authenticate(token_from(request.headers, request.cookies))
        if user is None:
            raise Unauthorized()
        return service.get_user(user["id"])  # type: ignore[return-value]

    def admin_user(user: dict = Depends(current_user)) -> dict:
        if not user["is_admin"]:
            raise Forbidden("admin only", "admin_only")
        return user

    def client_ip(request: Request) -> str:
        return request.client.host if request.client else "-"

    def set_session_cookie(request: Request, response: Response, token: str) -> None:
        secure = cfg.cookie_secure
        if secure is None:
            secure = (
                request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
                or request.url.scheme == "https"
            )
        response.set_cookie(
            COOKIE_NAME, token, max_age=cfg.session_days * 86400, httponly=True,
            samesite="lax", secure=bool(secure), path="/",
        )

    def login_response(request: Request, user: dict) -> JSONResponse:
        token = auth.issue_token(user["id"], request.headers.get("user-agent", ""))
        response = JSONResponse(service.me_view(service.get_user(user["id"])))
        set_session_cookie(request, response, token)
        return response

    # -- public --------------------------------------------------------------

    @app.get("/api/health")
    def health() -> dict:
        return {
            "ok": True,
            "telemetry": service.source.status(),
            "hub": hub.stats(),
            "walking": service.session is not None,
        }

    @app.get("/api/themes")
    def list_themes() -> list:
        out = []
        for journey in library.journeys.values():
            out.append({
                **journey.summary(),
                "lang": journey.data.get("lang"),
                "card_count": service.store.card_count(journey.id),
                "has_catalog": service.store.get(journey.id) is not None,
                "pack_every_m": service.rewards.pack_every_m(journey.id),
            })
        return out

    @app.get("/api/themes/{theme_id}/cards")
    def theme_cards(theme_id: str, request: Request) -> Response:
        if library.get(theme_id) is None:
            raise NotFound("unknown theme", "unknown_theme")
        catalog = service.store.get(theme_id)
        if catalog is None:
            raise NotFound("no card catalog for this theme yet", "catalog_unavailable")
        headers = {"ETag": f'"{catalog.etag}"', "Cache-Control": "public, max-age=3600"}
        if request.headers.get("if-none-match") == headers["ETag"]:
            return Response(status_code=304, headers=headers)
        body = {**catalog.data, "theme": theme_id, "pack": catalog.pack}
        return JSONResponse(body, headers=headers)

    # -- auth ----------------------------------------------------------------

    @app.post("/api/auth/register")
    def register(body: RegisterBody, request: Request) -> Response:
        register_limiter.check(client_ip(request), "register")
        register_limiter.failure(client_ip(request), "register")  # counts every attempt
        user = service.register(
            username=body.username, password=body.password, journey_id=body.journey_id,
            avatar=body.avatar, color=body.color, display_name=body.display_name,
            invite_code=body.invite_code,
        )
        return login_response(request, user)

    @app.post("/api/auth/login")
    def login(body: LoginBody, request: Request) -> Response:
        user = auth.login(body.username, body.password, client_ip(request))
        return login_response(request, user)

    @app.post("/api/auth/claim")
    def claim(body: LoginBody, request: Request) -> Response:
        user = service.claim(body.username, body.password, client_ip(request))
        return login_response(request, user)

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response) -> dict:
        auth.revoke(token_from(request.headers, request.cookies))
        response.delete_cookie(COOKIE_NAME, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    def auth_me(user: dict = Depends(current_user)) -> dict:
        return service.me_view(user)

    # -- shared (authenticated) ---------------------------------------------

    @app.get("/api/journeys")
    def get_journeys(_user: dict = Depends(current_user)) -> list:
        return library.list_summaries()

    @app.get("/api/journeys/{journey_id}")
    def get_journey(journey_id: str, _user: dict = Depends(current_user)) -> dict:
        journey = library.get(journey_id)
        if journey is None:
            raise NotFound("unknown journey")
        return journey.data

    @app.get("/api/leaderboard")
    def leaderboard(
        journey_id: Optional[str] = None,
        period: str = "week",
        user: dict = Depends(current_user),
    ) -> dict:
        return service.board.board(
            user["id"], journey_id or user["journey_id"] or service.default_journey_id, period
        )

    @app.get("/api/users/{user_id}/profile")
    def public_profile(user_id: int, _user: dict = Depends(current_user)) -> dict:
        profile = service.profiles.by_id(user_id)
        if profile is None:
            raise NotFound("unknown player")
        profile["recent_rares"] = service.collection.best_cards(user_id, profile["journey_id"])
        return profile

    @app.get("/api/live")
    def live(_user: dict = Depends(current_user)) -> list:
        return service.live_walkers()

    # -- /api/me : everything private ---------------------------------------

    @app.get("/api/me")
    def me(user: dict = Depends(current_user)) -> dict:
        return service.me_view(user)

    @app.patch("/api/me")
    def patch_me(body: PatchMeBody, user: dict = Depends(current_user)) -> dict:
        updated = service.update_profile(user["id"], **body.model_dump())
        return service.me_view(updated)

    @app.post("/api/me/password")
    def change_password(body: PasswordBody, request: Request,
                        user: dict = Depends(current_user)) -> dict:
        auth.change_password(user["id"], body.old, body.new,
                             keep_token=token_from(request.headers, request.cookies))
        return {"ok": True}

    @app.get("/api/me/state")
    def me_state(user: dict = Depends(current_user)) -> dict:
        return service.snapshot_for(user["id"])

    # sessions

    @app.get("/api/me/sessions")
    def my_sessions(limit: int = 50, user: dict = Depends(current_user)) -> list:
        return service.list_sessions(user["id"], limit=max(1, min(limit, 500)))

    @app.patch("/api/me/sessions/{session_id}")
    def patch_my_session(session_id: int, body: NoteBody,
                         user: dict = Depends(current_user)) -> dict:
        return service.update_session_note(user["id"], session_id, body.note)

    @app.delete("/api/me/sessions/{session_id}")
    def delete_my_session(session_id: int, user: dict = Depends(current_user)) -> dict:
        service.delete_session(user["id"], session_id)
        return {"deleted": session_id}

    @app.post("/api/me/sessions/manual")
    def manual_session(body: ManualSessionBody, user: dict = Depends(current_user)) -> dict:
        return service.add_manual_session(user["id"], **body.model_dump())

    # walking

    @app.post("/api/me/walk/start")
    def walk_start(body: Optional[StartWalkBody] = None,
                   user: dict = Depends(current_user)) -> Any:
        return service.start_session(user["id"], body.journey_id if body else None)

    @app.post("/api/me/walk/pause")
    def walk_pause(user: dict = Depends(current_user)) -> Any:
        return service.pause_session(user["id"])

    @app.post("/api/me/walk/resume")
    def walk_resume(user: dict = Depends(current_user)) -> Any:
        return service.resume_session(user["id"])

    @app.post("/api/me/walk/stop")
    def walk_stop(body: Optional[StopWalkBody] = None,
                  user: dict = Depends(current_user)) -> Any:
        return service.stop_session(user["id"], note=body.note if body else None)

    @app.post("/api/me/walk/choice")
    def walk_choice(body: ChoiceBody, user: dict = Depends(current_user)) -> dict:
        return service.answer_choice(user["id"], body.event_id, body.option_id)

    # history

    @app.get("/api/me/journal")
    def my_journal(limit: int = 40, user: dict = Depends(current_user)) -> list:
        return service.journal(user["id"], limit=max(1, min(limit, 200)))

    @app.get("/api/me/daily")
    def my_daily(days: int = 30, user: dict = Depends(current_user)) -> list:
        return service.daily_totals(user["id"], days=max(1, min(days, 365)))

    @app.get("/api/me/streak")
    def my_streak(user: dict = Depends(current_user)) -> dict:
        return service.streak(user["id"])

    # packs & cards

    @app.get("/api/me/packs")
    def my_packs(user: dict = Depends(current_user)) -> dict:
        return service.rewards.packs_view(user["id"])

    @app.post("/api/me/packs/{pack_id}/open")
    def open_pack(pack_id: int, user: dict = Depends(current_user)) -> dict:
        result = service.rewards.open_pack(user["id"], pack_id)
        return result

    @app.get("/api/me/collection")
    def my_collection(theme: Optional[str] = None, user: dict = Depends(current_user)) -> dict:
        return service.collection.view(user["id"], theme or user["journey_id"])

    @app.post("/api/me/craft")
    def craft(body: CraftBody, user: dict = Depends(current_user)) -> dict:
        return service.rewards.craft(user["id"], body.card_id)

    @app.get("/api/me/economy")
    def economy(_user: dict = Depends(current_user)) -> dict:
        return {
            "dup_essence": dict(DUP_ESSENCE),
            "craft_cost": dict(CRAFT_COST),
            "pack_every_m": {j.id: service.rewards.pack_every_m(j.id)
                             for j in library.journeys.values()},
            "manual_reward_cap_m": cfg.manual_reward_cap_m,
            "streak_tiers": list(STREAK_TIERS),
            "album_tiers": list(ALBUM_TIERS),
            "podium_packs": {str(k): v for k, v in PODIUM_PACKS.items()},
            "welcome_packs": WELCOME_PACKS,
        }

    # quests

    @app.get("/api/me/quests")
    def my_quests(user: dict = Depends(current_user)) -> list:
        return service.quests.list(user["id"])

    @app.post("/api/me/quests/{quest_id}/claim")
    def claim_quest(quest_id: str, user: dict = Depends(current_user)) -> dict:
        return service.quests.claim(user["id"], quest_id)

    # notifications & push

    @app.get("/api/me/notifications")
    def my_notifications(limit: int = 30, user: dict = Depends(current_user)) -> list:
        return service.notifier.list(user["id"], limit=max(1, min(limit, 200)))

    @app.post("/api/me/notifications/read")
    def read_notifications(body: ReadBody, user: dict = Depends(current_user)) -> dict:
        unread = service.notifier.mark_read(user["id"], ids=body.ids, all_=body.all)
        return {"ok": True, "unread": unread}

    @app.get("/api/me/push/vapid")
    def push_vapid(_user: dict = Depends(current_user)) -> dict:
        return {"public_key": service.push.public_key if service.push.supported else None}

    @app.post("/api/me/push/subscribe")
    def push_subscribe(body: PushSubscribeBody, user: dict = Depends(current_user)) -> dict:
        service.push.subscribe(user["id"], body.endpoint, body.keys.p256dh, body.keys.auth)
        return {"ok": True}

    @app.delete("/api/me/push/subscribe")
    def push_unsubscribe(endpoint: Optional[str] = None,
                         user: dict = Depends(current_user)) -> dict:
        return {"ok": True, "removed": service.push.unsubscribe(user["id"], endpoint)}

    # -- admin -----------------------------------------------------------------

    @app.get("/api/admin/users")
    def admin_users(_admin: dict = Depends(admin_user)) -> list:
        return [
            {**service.me_view(u), "archived": bool(u["archived"]),
             "has_password": u["has_password"], "last_seen_utc": u["last_seen_utc"]}
            for u in service.list_users(include_archived=True)
        ]

    @app.patch("/api/admin/users/{user_id}")
    def admin_patch_user(user_id: int, body: AdminPatchBody,
                         _admin: dict = Depends(admin_user)) -> dict:
        return service.me_view(service.admin_update_user(user_id, **body.model_dump()))

    @app.delete("/api/admin/users/{user_id}")
    def admin_delete_user(user_id: int, admin: dict = Depends(admin_user)) -> dict:
        if user_id == admin["id"]:
            raise WalkhomeError("you cannot delete yourself", 400, "self_delete")
        service.delete_user(user_id)
        return {"deleted": user_id}

    @app.post("/api/admin/adjustments")
    def admin_adjustment(body: AdjustmentBody, _admin: dict = Depends(admin_user)) -> dict:
        return service.add_adjustment(body.user_id, body.delta_m, body.reason, body.journey_id)

    # -- dev / simulator -----------------------------------------------------

    @app.post("/api/dev/sim")
    def sim_control(body: SimBody, user: dict = Depends(current_user)) -> dict:
        if not (cfg.dev_endpoints or user["is_admin"]):
            raise Forbidden("simulator control is disabled", "dev_disabled")
        source = service.source
        if not isinstance(source, SimulatedTelemetrySource):
            raise WalkhomeError("telemetry source is not the simulator", 400, "not_simulator")
        if body.speed_kmh is not None:
            source.set_speed(body.speed_kmh)
        if body.incline_pct is not None:
            source.set_incline(body.incline_pct)
        if body.drop_link_s:
            source.drop_link(body.drop_link_s)
        if body.reset_console:
            source.reset_console()
        if body.auto is not None:
            source.auto = body.auto
        return source.status()

    # -- websocket -----------------------------------------------------------

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        user = auth.authenticate(token_from(ws.headers, ws.cookies))
        await ws.accept()
        if user is None:
            await ws.close(code=4401)
            return
        uid = user["id"]
        client = await hub.register(ws.send_text, label=user["username"], user_id=uid)
        try:
            # Full private snapshot first, then the client rides its own tick stream.
            await hub.send_to(client, "snapshot", service.snapshot_for(uid))
            await hub.send_to(client, "live", service.live_brief())
            while True:
                msg = await ws.receive_text()
                if msg == "resync":
                    await hub.send_to(client, "snapshot", service.snapshot_for(uid))
                    await hub.send_to(client, "live", service.live_brief())
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            log.debug("websocket closed uncleanly", exc_info=True)
        finally:
            await hub.unregister(client)

    # -- static frontend -----------------------------------------------------

    web_dir: Path = cfg.web_dir
    if web_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")

    return app
