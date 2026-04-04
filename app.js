const screens = {
  landing: document.getElementById("landing-screen"),
  login: document.getElementById("login-screen"),
  dashboard: document.getElementById("dashboard-screen"),
};

const USER_STORAGE_KEY = "waywise-user";
const MUMBAI_BOUNDS = {
  north: 19.271,
  south: 18.892,
  east: 72.996,
  west: 72.775,
};

const state = {
  travelerName: "Traveler",
  selectedMode: "rail",
  ambientPlaying: false,
  ambientNodes: [],
  googleMapsReady: false,
  map: null,
  directionsService: null,
  directionsRenderer: null,
  lastOptions: [],
  routeCache: new Map(),
  selectedRouteId: null,
};

window.gm_authFailure = function gmAuthFailure() {
  disableGoogleFeatures("Google Maps authentication failed. Falling back to plain text Mumbai search.");
};

const modeConfig = {
  rail: {
    label: "Train stream active",
    description: "Google-powered train and metro planning across Mumbai with route alternatives and live map drawing.",
    themeClass: "mode-rail",
    services: ["all", "metro", "local", "train"],
  },
  bus: {
    label: "Bus stream active",
    description: "Google-powered bus planning across Mumbai with route alternatives and congestion-aware ranking.",
    themeClass: "mode-bus",
    services: ["all", "city"],
  },
  walking: {
    label: "Walking stream active",
    description: "Google-powered walking guidance for short-distance and last-mile journeys across Mumbai.",
    themeClass: "mode-walking",
    services: ["all", "walking"],
  },
};

function setScreen(screenName) {
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[screenName].classList.add("active");
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.97;
  utterance.pitch = 1.03;
  const femaleVoice = window.speechSynthesis
    .getVoices()
    .find((voice) => /female|zira|samantha|veena|google uk english female/i.test(voice.name));
  if (femaleVoice) utterance.voice = femaleVoice;
  window.speechSynthesis.speak(utterance);
}

function playAccentTone(type = "start") {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.type = type === "start" ? "triangle" : "sine";
  oscillator.frequency.value = type === "start" ? 420 : 310;
  gainNode.gain.setValueAtTime(0.001, context.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.04);
  gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.7);
}

function toggleAmbient() {
  if (state.ambientPlaying) {
    state.ambientNodes.forEach((node) => node.stop?.());
    state.ambientNodes = [];
    state.ambientPlaying = false;
    return;
  }

  const context = new (window.AudioContext || window.webkitAudioContext)();
  const bed = [110, 165, 220].map((frequency, index) => {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = index === 1 ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.012;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    return oscillator;
  });

  state.ambientNodes = bed;
  state.ambientPlaying = true;
}

function savedUser() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || "null");
    return parsed && parsed.name && parsed.email ? parsed : null;
  } catch {
    return null;
  }
}

function saveUser(name, email) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ name, email }));
}

function clearUser() {
  localStorage.removeItem(USER_STORAGE_KEY);
}

function applyMode(mode) {
  state.selectedMode = mode;
  const config = modeConfig[mode];
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.classList.toggle("active-mode", card.dataset.mode === mode);
  });
  document.querySelector(".app-shell").classList.remove("mode-rail", "mode-bus", "mode-walking");
  document.querySelector(".app-shell").classList.add(config.themeClass);
  document.getElementById("planner-kicker").textContent = config.label;
  document.getElementById("planner-title").textContent = `${mode[0].toUpperCase()}${mode.slice(1)} planner`;
  document.getElementById("planner-description").textContent = config.description;

  const serviceSelect = document.getElementById("service");
  serviceSelect.innerHTML = "";
  config.services.forEach((service) => {
    const option = document.createElement("option");
    option.value = service;
    option.textContent = service === "all" ? "All Services" : service[0].toUpperCase() + service.slice(1);
    serviceSelect.appendChild(option);
  });
}

function prettyMode(mode) {
  return { rail: "TRAIN", bus: "BUS", walking: "WALKING", multimodal: "MULTIMODAL" }[mode] || mode.toUpperCase();
}

function prettyProvider(provider) {
  return provider === "google_maps_live" ? "google-live" : provider;
}

function resetInputIfBroken(input) {
  if (!input) return;
  const value = String(input.value || "").trim().toLowerCase();
  if (value.includes("sorry") || value.includes("something went wrong")) {
    input.value = "";
  }
}

function disableGoogleFeatures(message) {
  state.googleMapsReady = false;
  state.directionsService = null;
  if (state.directionsRenderer) {
    state.directionsRenderer.setMap(null);
    state.directionsRenderer = null;
  }
  resetInputIfBroken(document.getElementById("source"));
  resetInputIfBroken(document.getElementById("destination"));
  setMapStatus(message, "Fallback");
}

function setMapStatus(text, pill = "Google Maps") {
  document.getElementById("map-status").textContent = text;
  document.getElementById("map-pill").textContent = pill;
}

function renderOverview(comparison) {
  const target = document.getElementById("overall-reco");
  if (!comparison.length) {
    target.textContent = "No overall recommendation found for this trip.";
    return;
  }

  const best = comparison[0];
  const ranking = comparison
    .map((item, index) => `${index + 1}. ${prettyMode(item.section)} - ${item.total_duration_min} min - INR ${item.total_cost_inr}`)
    .join("<br />");

  target.innerHTML = `
    <strong>${prettyMode(best.section)} is the best overall choice right now.</strong><br />
    Estimated time ${best.total_duration_min} min, estimated fare INR ${best.total_cost_inr}, transfers ${best.total_transfers}.<br />
    <span class="result-meta">${best.summary}</span><br /><br />
    <strong>Ranking</strong><br />
    ${ranking}
  `;
}

function estimateSegmentCost(mode, service, distanceMeters) {
  const km = Math.max(1, Math.round(distanceMeters / 1000));
  if (mode === "walking") return 0;
  if (mode === "bus") return 10 + km * 3;
  if (service === "metro") return 20 + km * 4;
  return 10 + km * 2;
}

function detectService(step) {
  if (!window.google) return "all";
  if (step.travel_mode === google.maps.TravelMode.WALKING) return "walking";
  const vehicleType = step.transit?.line?.vehicle?.type || "";
  const lineName = (step.transit?.line?.short_name || step.transit?.line?.name || "").toLowerCase();
  if (vehicleType === "BUS") return "city";
  if (lineName.includes("metro") || vehicleType === "SUBWAY") return "metro";
  if (lineName.includes("local")) return "local";
  return "train";
}

function routeModeFromStep(step) {
  if (!window.google) return "walking";
  if (step.travel_mode === google.maps.TravelMode.WALKING) return "walking";
  const vehicleType = step.transit?.line?.vehicle?.type || "";
  return vehicleType === "BUS" ? "bus" : "rail";
}

function scoreOption(option, preference) {
  if (preference === "fastest") {
    return option.total_duration_min + option.total_transfers * 4;
  }
  if (preference === "cheapest") {
    return option.total_cost_inr * 2.2 + option.total_duration_min * 0.35 + option.total_transfers * 2;
  }
  if (preference === "fewest_transfers") {
    return option.total_transfers * 32 + option.total_duration_min * 0.7 + option.total_cost_inr * 0.25;
  }
  return option.total_duration_min * 0.65 + option.total_cost_inr * 0.6 + option.total_transfers * 8;
}

function sortOptions(options, sortBy) {
  const cloned = [...options];
  if (sortBy === "fastest") {
    return cloned.sort((a, b) => a.total_duration_min - b.total_duration_min || a.total_cost_inr - b.total_cost_inr);
  }
  if (sortBy === "cheapest") {
    return cloned.sort((a, b) => a.total_cost_inr - b.total_cost_inr || a.total_duration_min - b.total_duration_min);
  }
  if (sortBy === "fewest_transfers") {
    return cloned.sort((a, b) => a.total_transfers - b.total_transfers || a.total_duration_min - b.total_duration_min);
  }
  return cloned.sort((a, b) => a.score - b.score);
}

function optionFromGoogleRoute(route, mode, requestMeta, routeIndex) {
  const leg = route.legs?.[0];
  if (!leg) return null;

  const segments = (leg.steps || []).map((step) => {
    const segmentMode = routeModeFromStep(step);
    const service = detectService(step);
    const distanceMeters = step.distance?.value || 0;
    const lineName =
      step.transit?.line?.short_name ||
      step.transit?.line?.name ||
      (segmentMode === "walking" ? "Walking Path" : segmentMode === "bus" ? "Bus Route" : "Train Line");

    return {
      mode: segmentMode,
      service,
      from_stop: step.transit?.departure_stop?.name || requestMeta.source,
      to_stop: step.transit?.arrival_stop?.name || step.instructions || requestMeta.destination,
      duration_min: Math.max(1, Math.round((step.duration?.value || 0) / 60)),
      cost_inr: estimateSegmentCost(segmentMode, service, distanceMeters),
      line_name: lineName,
      disruption: null,
      status: "on_time",
    };
  });

  const chosenService = requestMeta.service;
  const filteredByService =
    chosenService === "all" || segments.some((segment) => segment.service === chosenService || segment.mode === "walking");
  if (!filteredByService) return null;

  const totalDuration = Math.max(1, Math.round((leg.duration?.value || 0) / 60));
  const googleFare = route.fare?.value;
  const derivedCost = segments.reduce((sum, segment) => sum + segment.cost_inr, 0);
  const totalCost = googleFare ?? derivedCost;
  const totalTransfers = Math.max(0, segments.filter((segment) => segment.mode !== "walking").length - 1);
  const summary = segments.map((segment) => `${segment.mode}:${segment.to_stop}`).join(" -> ");
  const option = {
    route_id: `${mode}-${routeIndex}`,
    title: routeIndex === 1 ? "Best match" : `Option ${routeIndex}`,
    summary,
    provider: "google_maps_live",
    total_duration_min: totalDuration,
    total_cost_inr: totalCost,
    total_transfers: totalTransfers,
    status: totalTransfers >= 3 ? "adaptive" : "stable",
    reasoning: `Live Google Maps route optimized for ${requestMeta.preference.replace("_", " ")} across Mumbai.`,
    segments,
    googleRoute: route,
    section: mode,
    routeIndex,
  };
  option.score = scoreOption(option, requestMeta.preference);
  return option;
}

function routeRequestForMode(mode, source, destination) {
  if (!window.google) return null;
  const base = {
    origin: source,
    destination,
    provideRouteAlternatives: true,
    region: "IN",
  };

  if (mode === "walking") {
    return { ...base, travelMode: google.maps.TravelMode.WALKING };
  }

  const transitModes =
    mode === "bus"
      ? [google.maps.TransitMode.BUS]
      : [google.maps.TransitMode.TRAIN, google.maps.TransitMode.SUBWAY].filter(Boolean);

  return {
    ...base,
    travelMode: google.maps.TravelMode.TRANSIT,
    transitOptions: {
      modes: transitModes,
      routingPreference: google.maps.TransitRoutePreference.FEWER_TRANSFERS,
    },
  };
}

async function fetchClientConfig() {
  const response = await fetch("/api/client-config");
  return response.json();
}

async function loadGoogleMapsApi(apiKey) {
  if (window.google?.maps) return true;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return Boolean(window.google?.maps);
}

function initMapAndAutocomplete() {
  if (!window.google?.maps) {
    disableGoogleFeatures("Google Maps could not be initialized. Using plain text Mumbai search.");
    return;
  }

  const mapContainer = document.getElementById("live-map");
  state.map = new google.maps.Map(mapContainer, {
    center: { lat: 19.076, lng: 72.8777 },
    zoom: 11,
    styles: [
      { elementType: "geometry", stylers: [{ color: "#0f1f34" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#dcecff" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#08111f" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#24405f" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#09111f" }] },
      { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#5fc4ff" }] },
    ],
    disableDefaultUI: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  state.directionsService = new google.maps.DirectionsService();
  state.directionsRenderer = new google.maps.DirectionsRenderer({
    map: state.map,
    suppressMarkers: false,
    preserveViewport: false,
    polylineOptions: {
      strokeColor: "#72c8ff",
      strokeOpacity: 0.9,
      strokeWeight: 6,
    },
  });

  const autocompleteBounds = new google.maps.LatLngBounds(
    { lat: MUMBAI_BOUNDS.south, lng: MUMBAI_BOUNDS.west },
    { lat: MUMBAI_BOUNDS.north, lng: MUMBAI_BOUNDS.east }
  );

  const autocompleteOptions = {
    bounds: autocompleteBounds,
    componentRestrictions: { country: "in" },
    fields: ["formatted_address", "geometry", "name"],
    strictBounds: false,
  };

  if (!google.maps.places?.Autocomplete) {
    disableGoogleFeatures("Places library is unavailable. Check whether Places API is enabled.");
    return;
  }

  try {
    new google.maps.places.Autocomplete(document.getElementById("source"), autocompleteOptions);
    new google.maps.places.Autocomplete(document.getElementById("destination"), autocompleteOptions);
  } catch {
    disableGoogleFeatures("Autocomplete could not start. Using plain text Mumbai search.");
    return;
  }

  state.googleMapsReady = true;
  setMapStatus("Live Google Maps routing is active for Mumbai.", "Live Map");
}

function renderResults(options) {
  const resultList = document.getElementById("result-list");
  const resultEmpty = document.getElementById("result-empty");
  const statusPill = document.getElementById("status-pill");
  resultList.innerHTML = "";
  state.lastOptions = options;

  if (!options.length) {
    resultEmpty.style.display = "block";
    statusPill.textContent = "No route";
    statusPill.className = "status-pill caution";
    return;
  }

  resultEmpty.style.display = "none";
  statusPill.textContent = options[0].status;
  statusPill.className = `status-pill ${options[0].status}`;

  options.forEach((option, index) => {
    const wrapper = document.createElement("article");
    wrapper.className = `route-option${index === 0 ? " active-route" : ""}`;
    wrapper.dataset.routeId = option.route_id;
    wrapper.innerHTML = `
      <h4>${option.title}</h4>
      <p>${option.reasoning}</p>
      <div class="result-meta">
        <span>${prettyMode(option.section)}</span>
        <span>${option.total_duration_min} min</span>
        <span>INR ${option.total_cost_inr}</span>
        <span>${option.total_transfers} transfer(s)</span>
        <span>${prettyProvider(option.provider)}</span>
      </div>
      <div class="segment-list">
        ${option.segments
          .map(
            (segment) => `
              <div class="segment">
                <strong>${segment.mode.toUpperCase()} | ${segment.line_name}</strong>
                <p>${segment.from_stop} to ${segment.to_stop} - ${segment.duration_min} min - INR ${segment.cost_inr}</p>
                <p>${segment.disruption ? `Update: ${segment.disruption}` : "Live route segment"}</p>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    wrapper.addEventListener("click", () => displayRouteOnMap(option.route_id));
    resultList.appendChild(wrapper);
  });

  state.selectedRouteId = options[0].route_id;
}

function displayRouteOnMap(routeId) {
  const option = state.lastOptions.find((item) => item.route_id === routeId);
  if (!option || !state.directionsRenderer || !option.directionsResult) return;

  state.directionsRenderer.setDirections(option.directionsResult);
  state.directionsRenderer.setRouteIndex((option.routeIndex || 1) - 1);
  state.selectedRouteId = routeId;
  document.querySelectorAll(".route-option").forEach((card) => {
    card.classList.toggle("active-route", card.dataset.routeId === routeId);
  });
  setMapStatus(`Showing ${prettyMode(option.section)} route from ${option.segments[0]?.from_stop || "source"} to ${option.segments.at(-1)?.to_stop || "destination"}.`, "Live Route");
}

async function runGoogleRoute(request, mode) {
  return new Promise((resolve, reject) => {
    state.directionsService.route(routeRequestForMode(mode, request.source, request.destination), (result, status) => {
      if (status !== "OK" || !result?.routes?.length) {
        reject(new Error(`No ${mode} route found.`));
        return;
      }

      const options = result.routes
        .map((route, index) => optionFromGoogleRoute(route, mode, request, index + 1))
        .filter(Boolean)
        .map((option) => ({ ...option, directionsResult: result }));
      resolve(options);
    });
  });
}

async function fetchFallbackOptions(payload) {
  const response = await fetch("/api/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.detail || "Unable to fetch routes.");
  }
  return result.options.map((option) => ({ ...option, section: payload.section }));
}

async function planRoutes(event) {
  event.preventDefault();
  const request = {
    traveler_name: state.travelerName,
    source: document.getElementById("source").value.trim(),
    destination: document.getElementById("destination").value.trim(),
    section: state.selectedMode,
    service: document.getElementById("service").value,
    preference: document.getElementById("preference").value,
    sort_by: document.getElementById("sort-by").value,
  };

  if (!request.source || !request.destination) return;

  try {
    let activeOptions;
    let comparison = [];
    state.routeCache = new Map();

    if (state.googleMapsReady) {
      const allModes = ["rail", "bus", "walking"];
      const settled = await Promise.allSettled(allModes.map((mode) => runGoogleRoute(request, mode)));
      settled.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value.length) {
          const ranked = sortOptions(
            result.value.map((option) => ({ ...option, score: scoreOption(option, request.preference) })),
            request.sort_by
          );
          state.routeCache.set(allModes[index], ranked);
          comparison.push(ranked[0]);
        }
      });

      activeOptions = sortOptions(state.routeCache.get(request.section) || [], request.sort_by);
      comparison = sortOptions(
        comparison.map((option) => ({ ...option, score: scoreOption(option, request.preference) })),
        request.sort_by
      );
    } else {
      activeOptions = await fetchFallbackOptions(request);
      comparison = activeOptions.length ? [activeOptions[0]] : [];
      setMapStatus("Google Maps key missing. Showing fallback route intelligence without live map drawing.", "Fallback");
    }

    renderResults(activeOptions);
    renderOverview(comparison);
    if (state.googleMapsReady && activeOptions.length) {
      displayRouteOnMap(activeOptions[0].route_id);
    }
    playAccentTone("start");
    if (activeOptions.length) {
      speak(`Best ${prettyMode(request.section)} route loaded. Estimated time ${activeOptions[0].total_duration_min} minutes.`);
    }
  } catch (error) {
    renderResults([]);
    document.getElementById("result-empty").textContent = error.message || "Unable to fetch routes.";
    renderOverview([]);
    playAccentTone("alert");
  }
}

async function bootstrapGoogleMaps() {
  try {
    const config = await fetchClientConfig();
    if (!config.has_google_maps || !config.google_maps_browser_key) {
      disableGoogleFeatures("No Google Maps key found. Add GOOGLE_MAPS_BROWSER_API_KEY to enable live Mumbai maps.");
      return;
    }
    await loadGoogleMapsApi(config.google_maps_browser_key);
    initMapAndAutocomplete();
  } catch {
    disableGoogleFeatures("Google Maps could not be loaded. Check your API key, billing, and enabled APIs.");
  }
}

function enterDashboard(name) {
  state.travelerName = name;
  document.getElementById("welcome-name").textContent = `Hello, ${state.travelerName}`;
  setScreen("dashboard");
}

document.getElementById("start-button").addEventListener("click", () => {
  playAccentTone("start");
  const existingUser = savedUser();
  if (existingUser) {
    speak(`Welcome back to WayWise, ${existingUser.name}.`);
    enterDashboard(existingUser.name);
    return;
  }
  speak("Welcome to WayWise. Make your travel easy. Let's start the journey.");
  setScreen("login");
});

document.getElementById("voice-toggle").addEventListener("click", () => {
  speak("Welcome to WayWise. Make your travel easy.");
});

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("traveler-name").value.trim() || "Traveler";
  const email = document.getElementById("traveler-email").value.trim();
  saveUser(name, email);
  playAccentTone("start");
  speak(`Welcome, ${name}. Your login has been saved on this device.`);
  enterDashboard(name);
});

document.getElementById("route-form").addEventListener("submit", planRoutes);
document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    applyMode(card.dataset.mode);
    playAccentTone("start");
  });
});
document.getElementById("ambient-button").addEventListener("click", toggleAmbient);
document.getElementById("narrate-button").addEventListener("click", () => {
  speak("WayWise is ready with live Mumbai route planning.");
});
document.getElementById("reset-session-button").addEventListener("click", () => {
  clearUser();
  playAccentTone("alert");
  speak("Saved login cleared.");
  setScreen("landing");
});

window.addEventListener("load", async () => {
  applyMode("rail");
  await bootstrapGoogleMaps();
  const existingUser = savedUser();
  if (existingUser) {
    enterDashboard(existingUser.name);
    speak(`Welcome back to WayWise, ${existingUser.name}.`);
    return;
  }
  speak("Welcome to WayWise. Make your travel easy.");
});
