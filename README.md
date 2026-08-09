# Telephone-Booth BUSY Bar

Standalone physical status monitor for the
[Telephone-Booth](https://github.com/djensenius/Telephone-Booth) art
installation. It reads the authenticated
[Telephone-Booth Operator](https://github.com/djensenius/Telephone-Booth-Operator)
API and renders booth state, daily counters, and system health through BUSY
Cloud.

The service is deliberately independent of the Operator deployment. Run one
instance on an always-on home server, Portainer host, or cloud container.

## Front display

While the booth is healthy and idle, the front rotates through full-width
gradient cards:

- `READY`
- `CALLS n`
- `MSGS n`
- `SYSTEM OK`

Call activity interrupts the carousel immediately with `CALLING`, `PLAYING`,
`RECORDING`, or `SENDING`. Warnings and faults remain pinned until recovery.

## Requirements

- A BUSY Bar linked to BUSY Cloud
- A BUSY Cloud API token from <https://cloud.busy.app/api-tokens>
- A monitor-scoped token from the Operator console
- Outbound HTTPS/WSS access to BUSY Cloud and the Operator API

No inbound ports or database access are required.

## Portainer

Create a stack from [`compose.yaml`](compose.yaml), then define:

| Variable                    | Value                                      |
| --------------------------- | ------------------------------------------ |
| `BUSY_BAR_CLOUD_TOKEN`      | BUSY Cloud token                           |
| `BUSY_BAR_OPERATOR_API_URL` | Operator origin, without `/v1`             |
| `BUSY_BAR_OPERATOR_TOKEN`   | Monitor-scoped Operator token              |
| `BUSY_BAR_BOOTH_ID`         | Usually `booth-01`                         |
| `BUSY_BAR_DEVICE_ID`        | Optional; enables physical page navigation |

Deploy exactly one replica. The container exposes no ports.

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
- Daily counters reset in `America/Toronto`.
- Counter summaries refresh every 30 seconds.

`BUSY_BAR_STALE_AFTER_SECONDS` remains a legacy shared fallback. Prefer the
separate status and system thresholds.

## Deployment order

The daily carousel requires Operator API support for
`GET /v1/monitor/summary`. Deploy the matching Operator release before updating
this worker. Older Operator releases still provide state and health, but summary
polls will log `404` until the endpoint is available.
