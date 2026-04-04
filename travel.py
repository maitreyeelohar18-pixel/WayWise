from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ModeType = Literal["rail", "bus", "walking", "multimodal"]
PreferenceType = Literal["fastest", "cheapest", "balanced", "fewest_transfers"]


class RouteRequest(BaseModel):
    traveler_name: str = Field(default="Guest")
    source: str
    destination: str
    section: ModeType = Field(default="multimodal")
    service: str = Field(default="all")
    preference: PreferenceType = Field(default="balanced")
    sort_by: PreferenceType = Field(default="balanced")


class RouteSegment(BaseModel):
    mode: str
    service: str
    from_stop: str
    to_stop: str
    duration_min: int
    cost_inr: int
    line_name: str
    disruption: str | None = None
    status: str


class RouteOption(BaseModel):
    route_id: str
    title: str
    summary: str
    provider: str = "simulated"
    total_duration_min: int
    total_cost_inr: int
    total_transfers: int
    score: float
    status: str
    reasoning: str
    segments: list[RouteSegment]
