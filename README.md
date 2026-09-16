# BusyBar

Standalone physical status monitor for the
[Telephone-Booth](https://github.com/djensenius/Telephone-Booth) art
installation. It reads the authenticated
[Telephone-Booth Operator](https://github.com/djensenius/Telephone-Booth-Operator)
API and renders booth state, current-exhibition counters, booth hardware vitals, time,
optional weather, and system health through BUSY Cloud, with automatic LAN
failover when the local device URL and access key are configured.
It can also read the FluxHaus aggregate status API to interleave active
appliances and equipment, show car battery/range freshness, and announce
completed jobs.

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

- `PICKUP / DAY / n`
- `MSGS / DAY / n`
- `PICKUP / EXH / n`
- `MSGS / EXH / n`
- When the Operator summary includes `messagePlaybackStartsTotal`, `LISTEN / EXH / n`
- When the Operator summary includes `breakdownToday`, daily `NO DIAL`,
  `WRONG`, `LEFT`, `LISTEN`, and `INSTR` cards
- Fresh booth telemetry adds a four-step fan cooling meter and the Pi CPU temperature
- Fresh router component telemetry adds battery charge and battery temperature
  cards
- Fresh FluxHaus data adds one car slot split evenly between range and last-update
  age views, with battery charge remaining prominent on both
- While FluxHaus equipment is active, the complete active group is inserted
  after every normal card in the full `all` mode. The group can include the
  washer, dryer, dishwasher, BroomBot, MopBot, and air purifier
- Any rendered `DAY` card with an explicit value of `0` is omitted
- Unknown or missing pickup day totals still render as unavailable (`--`),
  while an absent `breakdownToday` block continues to hide the five breakout
  cards
- A 24-hour local clock with a weekday/date card
- Current weather, when Home Assistant weather is configured

Set `BUSY_BAR_FRONT_ROTATION_SECONDS` from 3 to 600 seconds (10 minutes) to
control how long each idle card remains visible. `EXH` totals cover only the
current exhibition, never archived exhibitions. `DAY` counts are today's portion
of that same exhibition.

Live booth activity interrupts the carousel immediately with `CALLING`, `PLAYING`,
`RECORDING`, or `SENDING`. Warnings and faults remain pinned until recovery.

When the Operator explicitly reports `installationState: "between_exhibitions"`,
offline is expected. Phone statistics and booth/router carousel cards are removed,
including in telephone-only mode; clock, weather, car, and appliance cards continue.
If no other cards are available, a single neutral `BETWEEN` screen is shown.
The rear overview explains how to start the next exhibition in the Operator
console. Cached phone totals are cleared on lifecycle transitions and return after
a fresh summary arrives. Missing or stale
booth telemetry does not sound an offline alarm during confirmed downtime.
Lifecycle is reconciled by status polling even when the API returns a synthetic,
id-less status; that response never counts as a fresh booth heartbeat.
If lifecycle confirmation itself becomes stale, normal offline alarms return.
Older servers that omit the field retain existing behavior. BUSY Cloud/device
failures and fresh critical hardware readings are still reported. Failed Operator
status, system, or router requests show `API ERROR`, independently of expected
booth downtime; the alert clears only after every failed feed recovers.

Pickup, message, breakout, and active-state cards use Canadian
telephone-booth pixel art.
The four hardware cards use the same booth art. The fan card maps commanded PWM
or cooling state to `OFF`, `LOW`, `MEDIUM`, `HIGH`, or `MAX` and deliberately
does not display tachometer RPM. Pi and router temperatures are rounded to whole
degrees on the front; the rear keeps decimal precision.
Weather uses condition-specific artwork for every Home Assistant weather state.
Its detail badge prefers precipitation probability, then a meaningful humidex
or wind-chill difference, then the daily high and low.
FluxHaus cards use device-specific pixel art and update through the same
debounced rendering path as the existing status sources. The purifier card uses
its preset mode as the status and labels its PM2.5 air-quality reading as `PM25`
for legibility; that value is fine particulate matter measured in `µg/m³`.

When a washer, dryer, dishwasher, BroomBot, or MopBot transitions from active
to finished, the front shows a ten-second `DONE` card. Simultaneous completions
are queued in device order. If BUSY Bar audio is enabled, each completion also
plays the configured stock sound. Initial snapshots establish a baseline and
never produce false completion alerts. The air purifier is displayed while its
fan is on but does not generate a completion alert.

## Rear display

The rear display keeps the booth overview, vitals, network, and `SMART HOME`
pages. The vitals page combines a four-step fan meter with Pi temperature, CPU,
memory, and uptime plus router battery charge, temperature, voltage, and
current. When the Operator summary includes
`breakdownToday`, the booth overview compacts the current-day pickup
breakout onto the rear page while still showing live booth details. The smart
home page shows the Start and dial scene mappings, whether the configured
lights currently match Comfy, the target and current brightness levels, and
the last smart-home action. A scene button temporarily opens this page for four
seconds, then returns to the previous page. Press Back to cycle backward
through all four rear pages.

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
| `BUSY_BAR_FLUXHAUS_ENABLED`     | Set `true` to add FluxHaus status          |
| `BUSY_BAR_FLUXHAUS_URL`         | FluxHaus server origin                     |
| `BUSY_BAR_FLUXHAUS_USERNAME`    | Read-only Basic auth user (default `demo`) |
| `BUSY_BAR_FLUXHAUS_PASSWORD`    | Read-only Basic auth password              |
| `BUSY_BAR_FLUXHAUS_POLL_SECONDS` | Poll interval (default `10`)              |
| `BUSY_BAR_FLUXHAUS_STALE_AFTER_SECONDS` | Card freshness window (default `120`) |

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

1. Deploy the matching Operator release first so `GET /v1/monitor/summary` and
   monitor-scoped access to `GET /v1/system/components/current` are available.
2. In Portainer, replace any service that uses the Operator API image and
   `node dist/busy-bar-worker.js` with [`compose.yaml`](compose.yaml).
3. Keep the existing BUSY Cloud token, then set the Operator URL, a
   monitor-scoped Operator token, and the booth id.
4. Use `75` seconds for status freshness, `20` seconds for system freshness,
   and `America/Toronto` for the daily reset unless the booth configuration
   differs.
5. Pull `ghcr.io/djensenius/busybar:latest` and redeploy the
   stack.
6. Verify the idle carousel, active-state overrides, structured logs, and
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
- Router battery telemetry leaves the carousel after five minutes without a new
  component snapshot.
- Today counters reset in `America/Toronto`; total counters cover the active installation.
- Counter summaries refresh every 30 seconds.
- The clock uses 24-hour time and can be disabled with
  `BUSY_BAR_CLOCK_ENABLED=false`.
- Weather refreshes every 10 minutes and disappears from the carousel after one
  hour without a successful Home Assistant response.
- FluxHaus refreshes every 10 seconds by default and its equipment/car cards
  disappear after two minutes without a successful response.

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

### FluxHaus status

Set `BUSY_BAR_FLUXHAUS_ENABLED=true`, provide the FluxHaus server origin, and
configure a dedicated read-only Basic credential. The existing FluxHaus
aggregate root response is used; BusyBar does not need direct Home Assistant
access for these cards. The FluxHaus deployment must set the matching
`DEMO_PASSWORD` for the default `demo` user, or another read-only username and
password may be supplied.

`BUSY_BAR_FLUXHAUS_POLL_SECONDS` accepts 5 to 3600 seconds and defaults to 10.
`BUSY_BAR_FLUXHAUS_STALE_AFTER_SECONDS` accepts 10 seconds to one day and
defaults to 120. Fetch or validation failures are logged and the last good
snapshot remains available only until that freshness threshold expires.

## Deployment order

The counter carousel requires Operator API support for
`GET /v1/monitor/summary`. Deploy the matching Operator release before updating
this worker. Older Operator releases still provide state and health, but summary
polls will log `404` until the endpoint is available.

Exhibition-only counters require an Operator release that scopes
`GET /v1/monitor/summary` to the current exhibition and reports
`installationState` in status responses. The worker does not re-scope totals
returned by older servers; deploy that Operator support first. Legacy summaries
without an active-exhibition marker retain the `ALL` label rather than claiming
their totals are exhibition-scoped.

The four core `PICKUP`/`MSGS` cards show `DAY` and `EXH` counts. Optional summary
fields add the `LISTEN / EXH` card, the five daily breakout cards, and the rear
overview breakout from the additive `interactions*` fields.
