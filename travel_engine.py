from __future__ import annotations

import heapq
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from backend.app.data.transport_data import EDGES, NODES, Edge
from backend.app.schemas import RouteOption, RouteRequest, RouteSegment
from backend.app.services.google_maps_service import build_google_route, has_google_maps_key


NODE_LOOKUP = {node.label.lower(): node for node in NODES}
GRAPH = defaultdict(list)

for edge in EDGES:
    GRAPH[edge.source].append(edge)
    if edge.bidirectional:
        GRAPH[edge.target].append(
            Edge(
                source=edge.target,
                target=edge.source,
                mode=edge.mode,
                service=edge.service,
                duration_min=edge.duration_min,
                cost_inr=edge.cost_inr,
                line_name=edge.line_name,
                bidirectional=edge.bidirectional,
            )
        )


def _current_hour() -> int:
    return datetime.now(ZoneInfo("Asia/Kolkata")).hour


def _disruption_for(edge: Edge) -> tuple[int, str | None, str]:
    hour = _current_hour()
    penalty = 0
    note = None
    status = "on_time"

    if edge.mode == "rail" and 8 <= hour <= 10:
        penalty += 5
        note = "Peak-hour crowding"
        status = "busy"
    if edge.mode == "bus" and edge.service == "city" and 18 <= hour <= 21:
        penalty += 8
        note = "Road congestion"
        status = "slow"
    if edge.line_name == "Trans Harbour Link":
        penalty += 6
        note = "Bridge approach traffic"
        status = "rerouted"
    if edge.mode == "walking" and hour >= 21:
        penalty += 4
        note = "Low-visibility walking advisory"
        status = "caution"

    return penalty, note, status


def _weight(preference: str, duration: int, cost: int, transfers: int) -> float:
    if preference == "fastest":
        return duration + (transfers * 4)
    if preference == "cheapest":
        return (cost * 2.4) + duration * 0.35 + transfers * 3
    if preference == "fewest_transfers":
        return transfers * 30 + duration * 0.7 + cost * 0.4
    return duration * 0.65 + cost * 0.75 + transfers * 8


def _allowed(edge: Edge, request: RouteRequest) -> bool:
    if request.section == "multimodal":
        return True
    if request.section != edge.mode:
        return False
    if request.service == "all":
        return True
    return edge.service == request.service


def _path_to_option(path: list[tuple[Edge, int, str | None, str]], request: RouteRequest, idx: int) -> RouteOption:
    segments: list[RouteSegment] = []
    total_duration = 0
    total_cost = 0
    statuses: list[str] = []

    for edge, penalty, note, status in path:
        duration = edge.duration_min + penalty
        total_duration += duration
        total_cost += edge.cost_inr
        statuses.append(status)
        segments.append(
            RouteSegment(
                mode=edge.mode,
                service=edge.service,
                from_stop=next(node.label for node in NODES if node.id == edge.source),
                to_stop=next(node.label for node in NODES if node.id == edge.target),
                duration_min=duration,
                cost_inr=edge.cost_inr,
                line_name=edge.line_name,
                disruption=note,
                status=status,
            )
        )

    transfers = max(0, len(path) - 1)
    score = round(_weight(request.preference, total_duration, total_cost, transfers), 2)
    overall_status = "stable"
    if "rerouted" in statuses:
        overall_status = "adaptive"
    elif "slow" in statuses or "busy" in statuses:
        overall_status = "watch"
    elif "caution" in statuses:
        overall_status = "caution"

    title = f"Option {idx}: {segments[0].from_stop} to {segments[-1].to_stop}"
    reasoning = (
        f"Optimized for {request.preference.replace('_', ' ')} with {transfers} transfer(s), "
        f"{total_duration} min total travel and INR {total_cost} fare."
    )
    summary = " -> ".join(f"{segment.mode}:{segment.to_stop}" for segment in segments)
    return RouteOption(
        route_id=f"{request.section}-{idx}",
        title=title,
        summary=summary,
        total_duration_min=total_duration,
        total_cost_inr=total_cost,
        total_transfers=transfers,
        score=score,
        status=overall_status,
        reasoning=reasoning,
        segments=segments,
    )


def _find_paths(start_id: str, end_id: str, request: RouteRequest, limit: int = 6) -> list[RouteOption]:
    frontier = [(0.0, 0, 0, 0, start_id, [])]
    results: list[RouteOption] = []
    seen = set()
    sequence = 1

    while frontier and len(results) < limit:
        weight, duration, cost, _, current, path = heapq.heappop(frontier)
        state_key = (current, len(path), round(weight, 1))
        if state_key in seen:
            continue
        seen.add(state_key)

        if current == end_id and path:
            results.append(_path_to_option(path, request, len(results) + 1))
            continue

        for edge in GRAPH[current]:
            if any(segment[0].source == edge.source and segment[0].target == edge.target for segment in path):
                continue
            if not _allowed(edge, request):
                continue

            penalty, note, status = _disruption_for(edge)
            next_duration = duration + edge.duration_min + penalty
            next_cost = cost + edge.cost_inr
            next_transfers = max(0, len(path))
            next_weight = _weight(request.preference, next_duration, next_cost, next_transfers)
            heapq.heappush(
                frontier,
                (
                    next_weight,
                    next_duration,
                    next_cost,
                    sequence,
                    edge.target,
                    path + [(edge, penalty, note, status)],
                ),
            )
            sequence += 1

    return results


def sort_options(options: list[RouteOption], sort_by: str) -> list[RouteOption]:
    if sort_by == "fastest":
        return sorted(options, key=lambda item: (item.total_duration_min, item.total_cost_inr))
    if sort_by == "cheapest":
        return sorted(options, key=lambda item: (item.total_cost_inr, item.total_duration_min))
    if sort_by == "fewest_transfers":
        return sorted(options, key=lambda item: (item.total_transfers, item.total_duration_min))
    return sorted(options, key=lambda item: item.score)


def _is_mumbai_query(request: RouteRequest) -> bool:
    search_text = f"{request.source} {request.destination}".lower()
    mumbai_terms = [
        "mumbai",
        "thane",
        "navi mumbai",
        "dadar",
        "kurla",
        "ghatkopar",
        "versova",
        "bkc",
        "andheri",
        "borivali",
        "mulund",
        "vashi",
    ]
    return any(term in search_text for term in mumbai_terms)


def build_route(request: RouteRequest) -> list[RouteOption]:
    if has_google_maps_key() and _is_mumbai_query(request):
        try:
            return build_google_route(request)
        except ValueError:
            pass

    source_node = NODE_LOOKUP.get(request.source.strip().lower())
    destination_node = NODE_LOOKUP.get(request.destination.strip().lower())

    if not source_node or not destination_node:
        known_places = ", ".join(node.label for node in NODES)
        raise ValueError(f"Unknown location. Try one of: {known_places}")
    if source_node.id == destination_node.id:
        raise ValueError("Source and destination should be different.")

    options = _find_paths(source_node.id, destination_node.id, request)
    if not options:
        raise ValueError("No route found for the selected mode and service. Try multimodal or all services.")
    return sort_options(options, request.sort_by)


def best_overview(request: RouteRequest) -> dict:
    candidates = []
    labels = {
        "rail": "Train-first recommendation",
        "bus": "Bus-first recommendation",
        "walking": "Walking-first recommendation",
        "multimodal": "Overall best recommendation",
    }

    for section in ("rail", "bus", "walking", "multimodal"):
        try:
            options = build_route(
                RouteRequest(
                    traveler_name=request.traveler_name,
                    source=request.source,
                    destination=request.destination,
                    section=section,
                    service="all",
                    preference=request.preference,
                    sort_by=request.sort_by,
                )
            )
        except ValueError:
            continue

        top = options[0]
        candidates.append(
            {
                "section": section,
                "label": labels[section],
                "duration_min": top.total_duration_min,
                "cost_inr": top.total_cost_inr,
                "transfers": top.total_transfers,
                "status": top.status,
                "summary": top.summary,
                "score": top.score,
            }
        )

    if not candidates:
        raise ValueError("No recommendation available for this trip.")

    candidates.sort(key=lambda item: item["score"])
    return {"best": candidates[0], "comparison": candidates}


def network_snapshot() -> dict:
    return {
        "nodes": [
            {"id": node.id, "label": node.label, "region": node.region, "x": node.x, "y": node.y}
            for node in NODES
        ],
        "edges": [
            {
                "source": edge.source,
                "target": edge.target,
                "mode": edge.mode,
                "service": edge.service,
                "duration_min": edge.duration_min,
                "cost_inr": edge.cost_inr,
                "line_name": edge.line_name,
            }
            for edge in EDGES
        ],
    }
