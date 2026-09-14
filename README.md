# 🧭 Uncharted

**Every road you drive clears the fog.**

Uncharted is a web app for the Tesla Model 3 touchscreen browser. It also works in any modern browser. It turns your drives into a map you slowly uncover. Along the way it tells you about the places you pass, coaches smooth driving, and shows live Waze traffic.

No accounts, no API keys, no paid services. Everything is stored locally in your browser.

**Open it:** https://datbluepony.github.io/uncharted/

---

## Features

### While driving (hands-off)
- **Heading-up 3D map** with a glowing car arrow and a light trail behind you. The map zooms out as your speed goes up.
- **Fog of war.** The world starts dark, and every road you drive reveals about 55 m around the car for good. The top bar shows the km² you've explored.
- **Road storyteller.** As you approach a notable place (historic site, park, bridge, museum, town, oddity), a card slides in and a voice reads a short story about it through the car speakers. The places come from Wikipedia's free location search.
- **Glass of water.** A virtual glass sloshes with your braking, acceleration and cornering, which the app works out from GPS speed and heading changes. Hard inputs spill water and lower your smooth score.
- **Spoken camera alerts.** Speed cameras and red-light cameras from OpenStreetMap trigger a banner and a voice alert when one is ahead of you.
- **Live status.** Speed, town/county/state, weather, sunrise/sunset/golden hour, clock, GPS quality.

### Waze Live (🚓 tab)
- Waze's official live map sits in a side panel, centered on your location. It shows real-time police, crashes, hazards, closures and traffic reported by Waze drivers. It recenters as you travel.

### Parked / passenger
These sections lock while the car is moving unless you tap *I'm a passenger*.
- **💎 Collection.** Every place you've passed, sorted into 6 categories with Common, Rare ✨ and Legendary 👑 rarities. You also collect towns, counties and states. Tap *Listen* to hear any place again.
- **🏁 Quests.** Three rotating daily quests plus lifetime milestones, with XP, levels and titles.
- **🛣️ Trips.** Every drive is recorded automatically. You get a weekly recap, lifetime stats and an **animated replay** where the route draws itself and places pop in as you reached them.
- **❓ Road Quiz.** A quiz built from places you actually drove past.
- **⚙️ Settings.** Units, map tilt, how often and how long the narration runs, categories, test voice, and a live **diagnostics** readout (GPS rate, accuracy, speech, WebGL).

---

## Using it in the Tesla

1. Open the Tesla browser and go to **https://datbluepony.github.io/uncharted/**.
2. Tap **Start driving**. Allow location if asked. The tap also unlocks audio.
3. Before your first real drive, open **Settings → Diagnostics** and check:
   - *Location source* shows `gps` with a position, and *Update rate* is around 1 Hz.
   - *Speech* says `yes`. Tap **Test** to hear the voice.
4. Drive. The fog clears, the stories play and the glass sloshes.

**Demo drive:** tap *Demo drive (simulated)* to see everything working while parked. It builds a route near you, or through Boston if location isn't available.
Direct links: `?sim=1&autostart=1` for a demo near you, `?sim=boston&autostart=1` for a demo in Boston.

> Keep your eyes on the road. While moving, the app is designed to be listened to and glanced at, not tapped.

---

## Free data sources (no keys)

| What | Source |
|---|---|
| Map tiles | CARTO Dark Matter vector tiles, © OpenStreetMap contributors |
| Places & stories | Wikipedia GeoSearch + extracts (CC BY-SA) |
| Town / county / state | BigDataCloud free reverse-geocode client (Nominatim as fallback) |
| Weather | Open-Meteo |
| Speed / red-light cameras | OpenStreetMap via Overpass API |
| Live traffic & police | Waze Live Map embed |
| Demo drive routes | OSRM public demo server |
| Voice | The browser's built-in speech synthesis |
| Map engine | MapLibre GL JS |

### About Waze alerts
Waze has no free public API for alert data, and its live-map feed rejects requests from outside waze.com. So the app shows Waze's **official embedded live map**, which updates in real time with police, crashes and hazards. The app can't read that map's contents, so it can't speak Waze alerts.

**Optional:** if you ever run your own proxy that returns Waze live-map JSON (`{ alerts: [...] }` in the georss format), paste its URL in **Settings → Alert feed URL**. Uncharted will then put police, crash, hazard and closure alerts on the map and speak them as you approach. The app works fully without it.

---

## Development

It's plain HTML/CSS/ES modules with no build step.

```bash
# any static server works
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:8080/?sim=boston&autostart=1`.

```
index.html        layout: map, top bar, story card, glass, Waze panel, dock, sheets
css/app.css       dark mission-control theme, sized for the 15" landscape screen
js/app.js         wiring + UI
js/util.js        geo math, event bus, localStorage/IndexedDB, settings
js/geo.js         real GPS source (fills in speed/heading when missing)
js/sim.js         simulated drive along a real route
js/map.js         MapLibre follow camera, trail, places, alert markers, car
js/fog.js         fog-of-war grid + canvas renderer
js/stories.js     Wikipedia places, categories, rarity, collection, narration
js/glass.js       glass-of-water physics + smooth score
js/speech.js      text-to-speech queue
js/place.js       reverse geocode, weather, sunrise/sunset
js/trips.js       trip detection, recording, streaks, lifetime stats
js/waze.js        Waze embed, OSM cameras, optional alert feed, spoken alerts
js/quests.js      daily quests, milestones, XP / levels
js/quiz.js        quiz generator from collected places
js/sheets.js      Collection, Quests, Trips (+ replay), Settings (+ diagnostics)
```
