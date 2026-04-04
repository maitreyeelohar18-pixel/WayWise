from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Node:
    id: str
    label: str
    region: str
    x: int
    y: int


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    mode: str
    service: str
    duration_min: int
    cost_inr: int
    line_name: str
    bidirectional: bool = True


NODES = [
    Node("mumbai_cst", "Mumbai CST", "Mumbai", 80, 290),
    Node("dadar", "Dadar", "Mumbai", 140, 245),
    Node("bkc", "BKC", "Mumbai", 160, 220),
    Node("kurla", "Kurla", "Mumbai", 205, 215),
    Node("ghatkopar", "Ghatkopar", "Mumbai", 250, 185),
    Node("versova", "Versova", "Mumbai", 75, 165),
    Node("thane", "Thane", "MMR", 320, 160),
    Node("navi_mumbai", "Navi Mumbai", "MMR", 300, 255),
    Node("pune", "Pune", "Pune", 345, 390),
    Node("lonavala", "Lonavala", "Pune", 300, 340),
    Node("nashik", "Nashik", "North Maharashtra", 395, 95),
    Node("aurangabad", "Aurangabad", "Marathwada", 535, 170),
    Node("nagpur", "Nagpur", "Vidarbha", 800, 205),
    Node("kolhapur", "Kolhapur", "West Maharashtra", 235, 530),
]


EDGES = [
    Edge("mumbai_cst", "dadar", "rail", "local", 12, 10, "Harbour Pulse"),
    Edge("dadar", "kurla", "rail", "local", 14, 10, "Central Flow"),
    Edge("kurla", "ghatkopar", "rail", "local", 9, 10, "Central Flow"),
    Edge("versova", "ghatkopar", "rail", "metro", 22, 40, "Metro Aqua"),
    Edge("bkc", "kurla", "rail", "metro", 8, 20, "Metro Bandra-Kurla"),
    Edge("dadar", "bkc", "bus", "city", 18, 18, "Business Loop"),
    Edge("mumbai_cst", "bkc", "bus", "city", 26, 24, "City Sprint"),
    Edge("bkc", "ghatkopar", "bus", "city", 30, 26, "Eastern Connector"),
    Edge("kurla", "thane", "rail", "local", 28, 15, "Suburban North"),
    Edge("ghatkopar", "thane", "bus", "city", 34, 25, "LBS Express"),
    Edge("kurla", "navi_mumbai", "bus", "city", 36, 28, "Trans Harbour Link"),
    Edge("thane", "navi_mumbai", "bus", "city", 40, 30, "Creek Connector"),
    Edge("thane", "nashik", "bus", "intercity", 155, 290, "Kasara Highway"),
    Edge("thane", "nashik", "rail", "express", 132, 180, "Godavari Arrow"),
    Edge("navi_mumbai", "pune", "bus", "intercity", 170, 330, "Mumbai-Pune Shuttle"),
    Edge("thane", "lonavala", "rail", "express", 120, 145, "Sahyadri Fast"),
    Edge("lonavala", "pune", "rail", "local", 62, 35, "Hill Local"),
    Edge("pune", "kolhapur", "bus", "intercity", 230, 420, "Mahalaxmi Roadway"),
    Edge("pune", "kolhapur", "rail", "express", 205, 280, "Southern Express"),
    Edge("nashik", "aurangabad", "bus", "intercity", 195, 320, "Marathwada Rider"),
    Edge("aurangabad", "nagpur", "rail", "express", 410, 540, "Vidarbha Link"),
    Edge("aurangabad", "nagpur", "bus", "intercity", 460, 620, "Orange Corridor"),
    Edge("pune", "aurangabad", "bus", "intercity", 255, 390, "Deccan Connect"),
    Edge("dadar", "versova", "bus", "city", 40, 22, "Western Arc"),
    Edge("bkc", "kurla", "walking", "walking", 24, 0, "Skywalk Route"),
    Edge("kurla", "ghatkopar", "walking", "walking", 54, 0, "Eastern Walk"),
    Edge("dadar", "bkc", "walking", "walking", 48, 0, "Riverfront Walk"),
    Edge("mumbai_cst", "dadar", "walking", "walking", 98, 0, "Heritage Walk"),
]
