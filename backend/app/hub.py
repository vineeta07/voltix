"""WebSocket fan-out. Any thread may call publish(); delivery happens on the event loop."""

import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: dict[int, set[WebSocket]] = defaultdict(set)

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    async def connect(self, site_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self.clients[site_id].add(ws)

    def disconnect(self, site_id: int, ws: WebSocket) -> None:
        self.clients[site_id].discard(ws)

    async def _send(self, site_id: int, text: str) -> None:
        for ws in list(self.clients[site_id]):
            try:
                await ws.send_text(text)
            except Exception:
                self.clients[site_id].discard(ws)

    def publish(self, site_id: int, message: dict) -> None:
        if not self.loop or not self.clients.get(site_id):
            return
        text = json.dumps(message, default=str)
        try:
            asyncio.run_coroutine_threadsafe(self._send(site_id, text), self.loop)
        except RuntimeError:
            pass


hub = Hub()
