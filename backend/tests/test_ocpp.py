"""A simulated OCPP 1.6J charger connects and receives SetChargingProfile."""

import asyncio

import websockets
from ocpp.routing import on
from ocpp.v16 import ChargePoint as CP
from ocpp.v16 import call, call_result
from ocpp.v16.enums import Action

from app import commands, ocpp_cs


class SimCharger(CP):
    received = None

    @on(Action.set_charging_profile)
    def on_profile(self, connector_id, cs_charging_profiles, **kw):
        SimCharger.received = (connector_id, cs_charging_profiles)
        return call_result.SetChargingProfile(status="Accepted")


async def test_charger_receives_set_charging_profile():
    commands.ocpp_limits.clear()
    server = asyncio.create_task(ocpp_cs.serve(19219, "127.0.0.1"))
    await asyncio.sleep(0.3)
    async with websockets.connect("ws://127.0.0.1:19219/CP-TEST", subprotocols=["ocpp1.6"]) as ws:
        cp = SimCharger("CP-TEST", ws)
        run = asyncio.create_task(cp.start())
        boot = await cp.call(call.BootNotification(charge_point_model="Sim",
                                                   charge_point_vendor="VOLTIX"))
        assert boot.status == "Accepted"
        commands.ocpp_limits["CP-TEST"] = 2300  # what set_plug() records for an OCPP plug
        for _ in range(40):
            if SimCharger.received:
                break
            await asyncio.sleep(0.1)
        run.cancel()
    server.cancel()
    assert SimCharger.received is not None
    connector, profile = SimCharger.received
    period = profile["charging_schedule"]["charging_schedule_period"][0]
    assert connector == 1 and period["limit"] == 2300
    assert profile["charging_schedule"]["charging_rate_unit"] == "W"
