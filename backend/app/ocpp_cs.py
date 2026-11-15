"""Minimal OCPP 1.6J central system.

Accepts charge points over WebSocket at ws://host:<port>/<charge_point_id>,
answers the core messages, and pushes the limits the scheduler asks for with
SetChargingProfile (TxDefaultProfile, watts). A plug of kind "ocpp" is paired
by using the charge point id as its topic.
"""

import asyncio
from datetime import UTC, datetime

import websockets
from ocpp.routing import on
from ocpp.v16 import ChargePoint as CP
from ocpp.v16 import call, call_result
from ocpp.v16.enums import Action, RegistrationStatus

from . import commands

connected: dict[str, "ChargePoint"] = {}


class ChargePoint(CP):
    applied_w: int | None = None

    @on(Action.boot_notification)
    def on_boot(self, **kwargs):
        return call_result.BootNotification(current_time=datetime.now(UTC).isoformat(),
                                            interval=60, status=RegistrationStatus.accepted)

    @on(Action.heartbeat)
    def on_heartbeat(self, **kwargs):
        return call_result.Heartbeat(current_time=datetime.now(UTC).isoformat())

    @on(Action.status_notification)
    def on_status(self, **kwargs):
        return call_result.StatusNotification()

    @on(Action.meter_values)
    def on_meter_values(self, **kwargs):
        return call_result.MeterValues()

    async def set_limit(self, watts: int, connector_id: int = 1):
        req = call.SetChargingProfile(connector_id=connector_id, cs_charging_profiles={
            "chargingProfileId": 1, "stackLevel": 0,
            "chargingProfilePurpose": "TxDefaultProfile", "chargingProfileKind": "Absolute",
            "chargingSchedule": {"chargingRateUnit": "W",
                                 "chargingSchedulePeriod": [{"startPeriod": 0,
                                                             "limit": float(watts)}]}})
        res = await self.call(req)
        if getattr(res, "status", None) == "Accepted":
            self.applied_w = watts
        return res


async def _handler(ws):
    path = getattr(getattr(ws, "request", None), "path", None) or getattr(ws, "path", "/")
    cp_id = path.strip("/").split("/")[-1]
    cp = ChargePoint(cp_id, ws)
    connected[cp_id] = cp
    try:
        await cp.start()
    except websockets.ConnectionClosed:
        pass
    finally:
        connected.pop(cp_id, None)


async def _push_limits() -> None:
    """Send any limit the scheduler has asked for that the charger does not have yet."""
    while True:
        for cp_id, want in list(commands.ocpp_limits.items()):
            cp = connected.get(cp_id)
            if cp and cp.applied_w != want:
                try:
                    await cp.set_limit(want)
                except Exception as e:
                    print(f"[ocpp] {cp_id}: {type(e).__name__}: {e}")
        await asyncio.sleep(1)


async def serve(port: int, host: str = "0.0.0.0") -> None:
    async with websockets.serve(_handler, host, port, subprotocols=[websockets.Subprotocol("ocpp1.6")]):
        print(f"[ocpp] central system listening on :{port}")
        await _push_limits()
