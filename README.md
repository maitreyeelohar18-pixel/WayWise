# WayWise

WayWise is a smart Mumbai-focused multi-modal travel planning platform. It combines a cinematic frontend with FastAPI, Leaflet and OpenStreetMap so users can search Mumbai locations, see live route drawing on a map, compare train, bus and walking options, and sort by fastest, cheapest or fewest transfers.

## Features

- Browser voiceover using the Web Speech API
- Saved login on the same device so users are not asked every time
- Mode-specific route planning for train, bus and walking
- Mumbai place suggestions with a free backend search
- Live map drawing with Leaflet and OpenStreetMap
- Fastest, cheapest, balanced and fewest-transfer sorting
- Overall comparison across available travel modes in Mumbai
- Optional openrouteservice routing for better free route geometry

## Project structure

- `frontend/`: HTML, CSS and browser JavaScript
- `backend/app/`: FastAPI app, schemas, data and routing engine

## Run locally

1. Install backend dependencies:
   `pip install -r backend/requirements.txt`
2. Optional for better free route geometry:
   Set an openrouteservice key in PowerShell:
   `$env:ORS_API_KEY="your_openrouteservice_key_here"`
3. Start the API server from the project root:
   `uvicorn backend.app.main:app --reload`
4. Open:
   `http://127.0.0.1:8000`

## Mumbai test locations

Try locations like:

- Dadar Station
- Thane Station
- Andheri Station
- Ghatkopar Metro Station
- Kurla Station
- CST Mumbai
- Bandra Kurla Complex
- Borivali Station
- Vashi Station
- Versova Metro Station

## Notes

- The voice is generated with the browser's built-in speech engine, so the exact voice depends on the device and browser.
- Without `ORS_API_KEY`, the app still works and shows a source-to-destination line on the free map.
- The free map stack uses Leaflet, OpenStreetMap and lightweight place search.
