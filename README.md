# Telephone-Booth BUSY Bar

Standalone physical status monitor for the
[Telephone-Booth](https://github.com/djensenius/Telephone-Booth) art
installation. It reads the authenticated
[Telephone-Booth Operator](https://github.com/djensenius/Telephone-Booth-Operator)
API and renders booth state, today/overall counters, time, optional weather, and system
health through BUSY Cloud.

The service is deliberately independent of the Operator deployment. Run one
instance on an always-on home server, Portainer host, or cloud container.

## Front display

While the booth is healthy and idle, the front rotates through full-width
gradient cards:

- `CALLS / DAY / n`
- `MSGS / DAY / n`
- `CALLS / ALL / n`
- `MSGS / ALL / n`
- A 24-hour local clock
- Current weather, when Home Assistant weather is configured

Call activity interrupts the carousel immediately with `CALLING`, `PLAYING`,
`RECORDING`, or `SENDING`. Warnings and faults remain pinned until recovery.

Calls, messages, and active states use Canadian telephone-booth pixel art.
Weather uses condition-specific artwork for every Home Assistant weather state.
Its detail badge prefers precipitation probability, then a meaningful humidex
or wind-chill difference, then the daily high and low.

## Requirements

- A BUSY Bar linked to BUSY Cloud
- A BUSY Cloud API token from <https://cloud.busy.app/api-tokens>
- A monitor-scoped token from the Operator console
- Outbound HTTPS/WSS access to BUSY Cloud and the Operator API
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
| `BUSY_BAR_LOCAL_URL`            | Optional LAN URL for physical input events |
| `BUSY_BAR_LOCAL_ACCESS_KEY`     | Password for the BUSY Bar LAN API          |
| `BUSY_BAR_WEATHER_ENABLED`      | Set `true` to add Home Assistant weather   |
| `BUSY_BAR_HOME_ASSISTANT_URL`   | Home Assistant origin                      |
| `BUSY_BAR_HOME_ASSISTANT_TOKEN` | Home Assistant long-lived access token    |

Deploy exactly one replica. The container exposes no ports.

### Physical dial modes

Configure the password-protected local URL and access key to receive physical
dial events. Turning the dial cycles through Weather, Clock, Weather + Clock,
Telephone Booth counters, and the full carousel. Active booth states and health
warnings continue to override the selected idle mode.

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
5. Pull `ghcr.io/djensenius/telephone-booth-busy-bar:latest` and redeploy the
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
23:00 local time, the monitor sets the hardware brightness to 5% and restores
automatic brightness at sunrise. Override the late-night level with
`BUSY_BAR_LATE_NIGHT_BRIGHTNESS`.

## Deployment order

The counter carousel requires Operator API support for
`GET /v1/monitor/summary`. Deploy the matching Operator release before updating
this worker. Older Operator releases still provide state and health, but summary
polls will log `404` until the endpoint is available.
