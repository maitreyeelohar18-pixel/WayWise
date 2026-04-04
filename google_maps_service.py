from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any

from backend.app.schemas import RouteOption, RouteRequest, RouteSegment


GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"


def has_google_maps_key() -> bool:
    return bool(os.getenv("GOOGLE_MAPS_API_KEY"))


def _google_get_json(base_url: str, params: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise ValueError("Google Maps API key is missing.")

    query = urllib.parse.urlencode({**params, "key": api_key})
    with urllib.request.urlopen(f"{base_url}?{query}", timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _normalize_location(location: str) -> str:
    cleaned = location.strip()
    lowered = cleaned.lower()
    if "mumbai" in lowered or "maharashtra" in lowered:
        return cleaned
    return f"{cleaned}, Mumbai, Maharashtra, India"


def _geocode_location(location: str) -> dict[str, Any]:
    payload = _google_get_json(
        GEOCODE_URL,
        {
            "address": _normalize_location(location),
            "region": "in",
            "components": "country:IN",
        },
    )
    if payload.get("status") != "OK" or not payload.get("results"):
        raise ValueError(f"Unable to geocode '{location}'.")
    return payload["results"][0]


def _service_from_vehicle(vehicle_type: str, short_name: str) -> str:
    lowered = short_name.lower()
    if vehicle_type in {"SUBWAY", "HEAVY_RAIL", "COMMUTER_TRAIN", "METRO_RAIL"}:
        if "metro" in lowered:
            return "metro"
        if "local" in lowered:
            return "local"
        return "train"
    if vehicle_type == "BUS":
        return "bus"
    return "walking"


def _clean_instruction(raw_text: str | None) -> str:
    if not raw_text:
        return "Walking segment"
    return re.sub(r"<[^>]+>", "", raw_text).strip()


def _mode_from_step(step: dict[str, Any]) -> tuple[str, str, str]:
    travel_mode = step.get("travel_mode", "WALKING")
    if travel_mode == "WALKING":
        return "walking", "walking", "Walk"

    transit = step.get("transit_details", {})
    line = transit.get("line", {})
    vehicle_type = line.get("vehicle", {}).get("type", "TRANSIT")
    short_name = line.get("short_name") or line.get("name") or "Transit"
    mode = "bus" if vehicle_type == "BUS" else "rail"
    service = _service_from_vehicle(vehicle_type, short_name)
    return mode, service, short_name


def _estimate_segment_cost(mode: str, service: str, distance_m: int) -> int:
    km = max(1, round(distance_m / 1000))
    if mode == "walking":
        return 0
    if mode == "bus":
        return 10 + (km * 3)
    if service == "metro":
        return 20 + (km * 4)
    return 10 + (km * 2)


def _route_status(route: dict[str, Any], transfers: int) -> str:
    if route.get("warnings"):
        return "watch"
    if transfers >= 3:
        return "adaptive"
    return "stable"


def _request_params(request: RouteRequest) -> dict[str, Any]:
    base = {
        "origin": _normalize_location(request.source),
        "destination": _normalize_location(request.destination),
        "alternatives": "true",
        "region": "in",
        "units": "metric",
    }

    if request.section == "walking":
        return {**base, "mode": "walking"}
    if request.section == "rail":
        return {**base, "mode": "transit", "transit_mode": "train", "departure_time": "now"}
    if request.section == "bus":
        return {**base, "mode": "transit", "transit_mode": "bus", "departure_time": "now"}
    return {**base, "mode": "transit", "departure_time": "now"}


def _option_from_google_route(route: dict[str, Any], request: RouteRequest, idx: int) -> RouteOption:
    legs = route.get("legs", [])
    if not legs:
        raise ValueError("Google Maps did not return any usable legs.")

    leg = legs[0]
    steps = leg.get("steps", [])
    segments: list[RouteSegment] = []
    running_cost = 0

    for step in steps:
        mode, service, line_name = _mode_from_step(step)
        duration_min = max(1, round(step.get("duration", {}).get("value", 0) / 60))
        distance_m = step.get("distance", {}).get("value", 0)
        segment_cost = _estimate_segment_cost(mode, service, distance_m)
        running_cost += segment_cost

        transit = step.get("transit_details", {})
        from_stop = transit.get("departure_stop", {}).get("name") or request.source
        to_stop = transit.get("arrival_stop", {}).get("name") or _clean_instruction(step.get("html_instructions")) or request.destination

        segments.append(
            RouteSegment(
                mode=mode,
                service=service,
                from_stop=from_stop,
                to_stop=to_stop,
                duration_min=duration_min,
                cost_inr=segment_cost,
                line_name=line_name,
                disruption=None,
                status="on_time",
            )
        )

    route_fare = route.get("fare", {}).get("value")
    total_cost = int(route_fare) if route_fare is not None else running_cost
    total_duration = max(1, round(leg.get("duration", {}).get("value", 0) / 60))
    transfers = max(0, sum(1 for segment in segments if segment.mode != "walking") - 1)
    score = round(
        {
            "fastest": total_duration + transfers * 4,
            "cheapest": total_cost * 2.2 + total_duration * 0.35 + transfers * 2,
            "fewest_transfers": transfers * 32 + total_duration * 0.7 + total_cost * 0.25,
        }.get(request.preference, total_duration * 0.65 + total_cost * 0.6 + transfers * 8),
        2,
    )
    status = _route_status(route, transfers)
    summary = " -> ".join(f"{segment.mode}:{segment.to_stop}" for segment in segments)
    reasoning = (
        f"Google-powered route ranked for {request.preference.replace('_', ' ')}. "
        f"Travel time {total_duration} min, estimated fare INR {total_cost}, transfers {transfers}."
    )

    return RouteOption(
        route_id=f"google-{request.section}-{idx}",
        title=f"Option {idx}",
        summary=summary,
        provider="google_maps",
        total_duration_min=total_duration,
        total_cost_inr=total_cost,
        total_transfers=transfers,
        score=score,
        status=status,
        reasoning=reasoning,
        segments=segments,
    )


def _sort_options(options: list[RouteOption], sort_by: str) -> list[RouteOption]:
    if sort_by == "fastest":
        return sorted(options, key=lambda item: (item.total_duration_min, item.total_cost_inr))
    if sort_by == "cheapest":
        return sorted(options, key=lambda item: (item.total_cost_inr, item.total_duration_min))
    if sort_by == "fewest_transfers":
        return sorted(options, key=lambda item: (item.total_transfers, item.total_duration_min))
    return sorted(options, key=lambda item: item.score)


def build_google_route(request: RouteRequest) -> list[RouteOption]:
    _geocode_location(request.source)
    _geocode_location(request.destination)
    payload = _google_get_json(DIRECTIONS_URL, _request_params(request))
    if payload.get("status") != "OK" or not payload.get("routes"):
        raise ValueError(payload.get("error_message") or "Google Maps could not find a route.")

    options = [
        _option_from_google_route(route, request, idx + 1)
        for idx, route in enumerate(payload["routes"][:4])
    ]
    return _sort_options(options, request.sort_by)
