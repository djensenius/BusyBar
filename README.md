# BusyBar

Standalone physical status monitor for the
[Telephone-Booth](https://github.com/djensenius/Telephone-Booth) art
installation. It reads the authenticated
[Telephone-Booth Operator](https://github.com/djensenius/Telephone-Booth-Operator)
API and renders booth state, today/overall counters, time, optional weather, and system
health through BUSY Cloud, with automatic LAN failover when the local device URL is configured.

The service is deliberately independent of the Operator deployment. Run one
instance on an always-on home server, Portainer host, or cloud container.

## Display demo

Open the [interactive BusyBar display demo](https://djensenius.github.io/BusyBar/)
to preview the idle carousel, live clock layout, smart weather details, active
states, and warnings. The self-contained GitHub Pages source lives in
[`demo/`](demo/).

## Front display

While the booth is healthy and idle, the front rotates through full-width
gradient cards:

- `CALLS / DAY / n`
- `MSGS / DAY / n`
- `CALLS / ALL / n`
- `MSGS / ALL / n`
- A 24-hour local clock with a weekday/date card
- Current weather, when Home Assistant weather is configured

Set `BUSY_BAR_FRONT_ROTATION_SECONDS` from 3 to 600 seconds (10 minutes) to
control how long each idle card remains visible.

Call activity interrupts the carousel immediately with `CALLING`, `PLAYING`,
`RECORDING`, or `SENDING`. Warnings and faults remain pinned until recovery.

Calls, messages, and active states use Canadian telephone-booth pixel art.
Weather uses condition-specific artwork for every Home Assistant weather state.
Its detail badge prefers precipitation probability, then a meaningful humidex
or wind-chill difference, then the daily high and low.

## Rear display

The rear display keeps the existing booth overview, system, and network pages,
and adds a `SMART HOME` page. It shows the Start and dial scene mappings,
whether the configured lights currently match Comfy, the target and current
brightness levels, and the last smart-home action. A scene button temporarily
opens this page for four seconds, then returns to the previous page. Press Back
to cycle backward through all four rear pages.

## Requirements

- A BUSY Bar linked to BUSY Cloud
- A BUSY Cloud API token from <https://cloud.busy.app/api-tokens>
- A monitor-scoped token from the Operator console
- Outbound access to BUSY Cloud and the Operator API
- Optional LAN access to the BUSY Bar for display failover and physical input
- Optional Home Assistant access for weather

No inbound ports or database access are required.

## Portainer

Create a stack from [`compose.yaml`](compose.yaml), then define:

| Variable                        | Value                                      |
| ------------------------------- | ------------------------------------------ |
| `BUSY_BAR_CLOUD_TOKEN`          | BUSY Cloud token                           |
| `BUSY_BAR_OPERATOR_API_URL`     | Operator origin, without `/v1`             |
| `BUSY_BAR_OPERATOR_TOKEN`       | Monitor-scoped Operator token              |
| `BUSY_BAR_BOOTH_ID`             | Usually `booth-01`                         |
| `BUSY_BAR_LOCAL_URL`            | Optional LAN URL for input and display failover |
| `BUSY_BAR_LOCAL_ACCESS_KEY`     | Password for the BUSY Bar LAN API          |
| `BUSY_BAR_START_SCENE_ID`       | Scene for Start/Pause, such as `scene.comfy` |
| `BUSY_BAR_DIAL_SCENE_ID`        | Scene for dial press, such as `scene.good_night` |
| `BUSY_BAR_WEATHER_ENABLED`      | Set `true` to add Home Assistant weather   |
| `BUSY_BAR_HOME_ASSISTANT_URL`   | Home Assistant origin                      |
| `BUSY_BAR_HOME_ASSISTANT_TOKEN` | Home Assistant long-lived access token    |
| `BUSY_BAR_START_TOGGLE_LIGHT_IDS` | Optional comma-separated lights turned off by a second Start/Pause press |

Deploy exactly one replica. The container exposes no ports.

### Physical dial modes

Configure the password-protected local URL and access key to receive physical
dial events. Turning the dial cycles through Weather, Clock, Weather + Clock,
Telephone Booth counters, and the full carousel. Active booth states and health
warnings continue to override the selected idle mode.

The local connection also keeps display updates available during BUSY Cloud
errors and uses a WebSocket heartbeat to reconnect stalled input streams.

The Start/Pause button and dial press can activate Home Assistant scenes with
`BUSY_BAR_START_SCENE_ID` and `BUSY_BAR_DIAL_SCENE_ID`. Both trigger only on
the initial button press; dial rotation continues to select the idle display
mode. A successful scene activation plays a short color-sweep confirmation on
the front display. When `BUSY_BAR_START_TOGGLE_LIGHT_IDS` is configured, the
Start/Pause button compares those lights with the on state and brightness saved
in the scene. If every light matches, it turns only those lights off and
displays `LIGHTS OFF`; otherwise it activates the configured scene. For Comfy, use
`light.kitchen_island_lights,light.kitchen_main_lights,light.living_room_main_lights`
to make a second press turn off the overhead lighting while leaving the lamps
on.

### Updating an existing Portainer stack

1. Deploy the matching Operator release first so
   `GET /v1/monitor/summary` is available.
2. In Portainer, replace any service that uses the Operator API image and
   `node dist/busy-bar-worker.js` with [`compose.yaml`](compose.yaml).
3. Keep the existing BUSY Cloud token, then set the Operator URL, a
   monitor-scoped Operator token, and the booth id.
4. Use `75` seconds for status freshness, `20` seconds for system freshness,
   and `America/Toronto` for the daily reset unless the booth configuration
   differs.
5. Pull `ghcr.io/djensenius/busybar:latest` and redeploy the
   stack.
6. Verify the idle carousel, active-call overrides, structured logs, and
   recovery after restarting the container.

After the first image is published, ensure the GHCR package is public before
pulling it anonymously from Portainer.

## Local development

```sh
mise install
pnpm install
cp .env.example .env
pnpm dev
```

Run the checks with:

```sh
pnpm check
```

## Configuration

See [`.env.example`](.env.example) for every setting. Notable defaults:

- Status is stale after 75 seconds because the booth heartbeat defaults to 30
  seconds.
- System telemetry is stale after 20 seconds because snapshots normally arrive
  every five seconds.
- Today counters reset in `America/Toronto`; total counters cover the active installation.
- Counter summaries refresh every 30 seconds.
- The clock uses 24-hour time and can be disabled with
  `BUSY_BAR_CLOCK_ENABLED=false`.
- Weather refreshes every 10 minutes and disappears from the carousel after one
  hour without a successful Home Assistant response.

`BUSY_BAR_STALE_AFTER_SECONDS` remains a legacy shared fallback. Prefer the
separate status and system thresholds.

### Home Assistant weather

Set `BUSY_BAR_WEATHER_ENABLED=true`, then provide a Home Assistant URL,
long-lived access token, and weather entity. The recommended Environment Canada
configuration is:

```env
BUSY_BAR_WEATHER_ENTITY_ID=weather.patio_environment_canada_forecast
BUSY_BAR_SUN_ENTITY_ID=sun.sun
BUSY_BAR_WEATHER_HUMIDEX_ENTITY_ID=sensor.patio_environment_canada_humidex
BUSY_BAR_WEATHER_WIND_CHILL_ENTITY_ID=sensor.patio_environment_canada_wind_chill
BUSY_BAR_WEATHER_PRECIPITATION_ENTITY_ID=sensor.patio_environment_canada_chance_of_precipitation
```

The optional companion sensors improve the detail badge. The weather entity
still supplies current conditions, temperature, and hourly/daily forecasts.
The standard Home Assistant `sun.sun` entity automatically switches idle cards
to black backgrounds with condition colors used as accents after sunset. At
23:00 local time, the monitor sets the hardware brightness to the configured
late-night level and restores automatic brightness at sunrise. Set
`BUSY_BAR_LATE_NIGHT_BRIGHTNESS` from 0 to 100 percent; the default is 5.

## Deployment order

The counter carousel requires Operator API support for
`GET /v1/monitor/summary`. Deploy the matching Operator release before updating
this worker. Older Operator releases still provide state and health, but summary
polls will log `404` until the endpoint is available.
