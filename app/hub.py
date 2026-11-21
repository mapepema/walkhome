"""WebSocket fan-out.

The Pi is the single source of truth; every phone, tablet and TV is just a
view. Each client is bound to ONE user at connect time and the hub filters:
private messages (snapshot, tick, reward, notify, rank, event, challenge) are
addressed to a ``user_id`` and are never delivered to anybody else; only
explicitly public messages (``live``) reach everyone.

Every message carries a monotonic ``seq`` so a client can discard anything
that arrives late or twice.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger(__name__)

# Bounded per-client queue: a backgrounded phone must never slow the telemetry
# loop. Ticks are dropped for that client and the next snapshot repairs it.
CLIENT_QUEUE_MAX = 32


@dataclass
class Client:
    id: int
    send: Callable[[str], Awaitable[None]]
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(CLIENT_QUEUE_MAX))
    dropped: int = 0
    label: str = "viewer"
    user_id: Optional[int] = None


class Hub:
    def __init__(self) -> None:
        self._clients: dict[int, Client] = {}
        self._writers: dict[int, asyncio.Task] = {}
        self._seq = 0
        self._next_id = 1
        self._lock = asyncio.Lock()

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def _envelope(self, message_type: str, data: Any) -> str:
        self._seq += 1
        return json.dumps(
            {
                "type": message_type,
                "seq": self._seq,
                "server_time": datetime.now(timezone.utc).isoformat(
                    timespec="milliseconds"
                ),
                "data": data,
            },
            default=str,
        )

    async def register(
        self,
        send: Callable[[str], Awaitable[None]],
        label: str = "viewer",
        user_id: Optional[int] = None,
    ) -> Client:
        async with self._lock:
            client = Client(id=self._next_id, send=send, label=label, user_id=user_id)
            self._next_id += 1
            self._clients[client.id] = client
            self._writers[client.id] = asyncio.create_task(self._writer(client))
        log.info("client %s connected (%d total)", client.id, len(self._clients))
        return client

    async def unregister(self, client: Client) -> None:
        async with self._lock:
            self._clients.pop(client.id, None)
            task = self._writers.pop(client.id, None)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        log.info("client %s disconnected (%d left)", client.id, len(self._clients))

    async def _writer(self, client: Client) -> None:
        try:
            while True:
                payload = await client.queue.get()
                await client.send(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad socket must not matter
            log.info("client %s write failed: %s", client.id, exc)

    async def send_to(self, client: Client, message_type: str, data: Any) -> None:
        """Direct send, used for the connect-time snapshot and command replies."""
        await client.send(self._envelope(message_type, data))

    def has_user(self, user_id: int) -> bool:
        return any(c.user_id == user_id for c in self._clients.values())

    async def broadcast(
        self, message_type: str, data: Any, user_id: Optional[int] = None
    ) -> None:
        """Send to every client (public message) or, with ``user_id``, only to
        that user's clients (private message)."""
        targets = [
            c for c in self._clients.values() if user_id is None or c.user_id == user_id
        ]
        if not targets:
            self._seq += 1  # keep seq monotonic even with nobody watching
            return
        payload = self._envelope(message_type, data)
        for client in targets:
            try:
                client.queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop the oldest tick rather than the newest: stale telemetry
                # is worth less than current telemetry.
                client.dropped += 1
                with contextlib.suppress(asyncio.QueueEmpty):
                    client.queue.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    client.queue.put_nowait(payload)

    def stats(self) -> dict:
        return {
            "clients": len(self._clients),
            "seq": self._seq,
            "dropped": sum(c.dropped for c in self._clients.values()),
        }

    async def close(self) -> None:
        for client in list(self._clients.values()):
            await self.unregister(client)
