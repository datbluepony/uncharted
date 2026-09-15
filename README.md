# 🧭 Uncharted

**Every road you drive clears the fog.**

Uncharted is a web app for the Tesla Model 3 touchscreen browser. It also works in any modern browser. It turns your drives into a map you slowly uncover. Along the way it tells you about the places you pass, coaches smooth driving, and shows live Waze traffic.

No accounts, no API keys, no paid services. Everything is stored locally in your browser.

**Open it:** https://datbluepony.github.io/uncharted/

---

*for Andrew & Jenna ✦ by Andrew & Jenna*

## What's new
- **Opening screen:** an animated night drive with aurora, drifting fog, a Model 3 heading for the horizon and an A ✦ J constellation. It shows a personal greeting and your journey stats so far.
- **Tap any place for the full story:** story cards, map pins, toasts and collection items open a full-screen pop-up. It has a large photo, key facts, the article in readable sections, a photo gallery, nearby places, live distance and direction, a Listen button, and a QR code that sends the location to your phone (share it to the Tesla app). Links inside the story open in the same pop-up with a back button.
- **🚘 Car screen:** a live, animated Model 3 showing:
  - speed arc, compass, headlights, brake lights and a g-force meter
  - estimated energy use (Wh/mi, kWh used, regen, estimated range) from a physics model of your trim
  - nearest Superchargers with direction arrows
  - the car's software version and onboard computer, detected from the browser
  - connectivity and latency, elevation profile, and the sun's position
- **Sound that works:** a natural neural voice runs entirely in the browser (one-time 63 MB download), so stories play even when the car has no built-in speech voices. Chimes play for collections, quests and alerts. Settings → Sound has a Test button and troubleshooting tips.
- **Superchargers on the map**, plus a ⚡ distance chip in the top bar.

## 🌌 Sky tab
- **Live star map:** oriented to where the car is pointing, with an **AHEAD** marker and compass on the horizon. It shows 5,044 real stars (sized by brightness and colored by temperature), constellation lines and names, and the famous shapes: Big Dipper, Little Dipper, Orion's Belt, Summer and Winter Triangles, Great Square, Northern Cross, the Teapot. It also shows the planets, the Moon with its real phase, deep-sky objects, a Milky Way glowing where it really is, and twilight colors from the Sun's position.
- **Interactive:** drag to look around (with momentum), pinch or scroll to zoom, double-tap to zoom in, **Car view** to snap back to the windshield, and **Look up** for overhead.
- **Tap anything:** the card tells you exactly where to look ("52° up, ahead to the right"), plus distance, what year the light left the star, rise and set times and a fact. **Full story** opens the Wikipedia article.
- **Find buttons:** jump to the Moon, the North Star, the Big Dipper and whatever planets are up right now. With the Big Dipper selected, an animated line follows the pointer stars to Polaris.
- **Time travel:** a slider moves ±12 hours, and ⏩ plays a time-lapse of the sky turning.
- **Solar System view:** real planet positions for today, orbits, the asteroid belt, a pulse showing sunlight's 8-minute trip, and time-lapse up to 1 year per second.
- **Galaxy view:** the Milky Way with "You are here" on the Orion Spur, and a live count of how far you've traveled around the galaxy.
- **Cosmic speedometer:** your car vs Earth's spin vs Earth's orbit vs the Sun's orbit around the galaxy.
- **Night vision** red mode. Data: d3-celestial star catalog and astronomy-engine, both free and cached for offline use.

## 🚨 Road alerts (on our own map, no Waze)
- **Live Florida 511 incidents** from FDOT's public data service: police activity, emergency vehicles, crashes, closures, disabled vehicles, debris and hazards, road work, and congestion. They show as animated markers on the map, refreshed every 90 seconds.
- **Police within your alert distance** (1–3 mi, default 2) flash red and blue on the screen edges, show a banner with a live distance countdown, and play a soft two-tone chime. Crashes and closures flash red; hazards flash amber.
- **National Weather Service warnings** for your exact location (flood, tornado, severe storms).
- **Speed and red-light cameras** from OpenStreetMap.
- The **🚨 Alerts** tab lists everything nearby by distance, with direction arrows; tap one to fly to it.
- Limits: police alerts cover only what Florida 511 reports (troopers and incidents on major roads). Crowd-reported police traps from Waze aren't available to outside apps.

## 🗺️ Map look
- Neon night basemap: glowing highways, deep water, 3D glass buildings, and an atmospheric horizon when tilted.
- A new car icon with headlights and a radar sweep, and a light trail that fades in behind you.
- Floating **loot beacons** over nearby undiscovered places. Rare and legendary ones have light pillars. Collecting one bursts **+XP** particles.
- Level ring in the top bar, and a **Next discovery** guide with a direction arrow.

## Sound
- **Volume slider:** Settings → Sound, 0–200%, with a compressor so boosting doesn't distort.
- **Soft chime:** a gentle bell rings whenever a place pops up. Tap the card, its notification, or a map pin to read more.
- **Dark Waze:** the Waze live map is dimmed to match the app (toggle in Settings → Alerts).

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

## Performance & reliability

- **Fog is drawn on the GPU.** A small WebGL layer draws a texture covering 10 km around the car. The CPU only touches it when new ground is revealed (under 5 ms) or when the car moves more than 3 km (one redraw, about 0.2 s for 40,000 explored cells). Pan, zoom, tilt and rotation cost nothing extra.
- The glass animation is capped at 30 fps and stops when hidden. The map doesn't animate behind full-screen sections. Only one replay map exists at a time, since car hardware has few WebGL contexts to spare.
- If the browser doesn't report speed, the app works it out from position changes. That estimate is smoothed hard, and movement within the GPS accuracy circle is ignored, so parked drift doesn't trigger spills.
- If the browser is closed mid-drive, the drive is saved the next time you open the app.
- A service worker caches the app itself, so it still opens on weak LTE.

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
