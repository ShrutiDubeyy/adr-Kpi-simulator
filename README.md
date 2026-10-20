# ADR KPI Simulator API

A standalone Node.js REST service that emits synthetic data for testing an ADR Orchestrator. **All responses are simulated and are not evidence of real field performance.** No physical controls are connected.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Health check: `http://localhost:8080/health`

## Quick start

Create a session:

```bash
curl -X POST http://localhost:8080/api/v1/simulator/sessions \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"success","seed":42,"consumerCount":5,"intervalMinutes":15}'
```

Copy `data.session.id` from the response, then call:

```bash
curl http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/consumers
curl http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/assets
curl 'http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/meter-readings?limit=96'
curl http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/forecasts
curl http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/economics
```

Create and execute an event:

```bash
curl -X POST http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/events \
  -H 'Content-Type: application/json' -d '{"targetReductionKw":25,"durationMinutes":60}'

curl -X POST http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/events/EVENT_ID/execute
curl http://localhost:8080/api/v1/simulator/sessions/SESSION_ID/events/EVENT_ID/mv
```

## Scenarios

`normal`, `success`, `dispatch_failure`, `guardrail_violation`, `missing_data`, `revert_failure`, `economic_sensitivity`, `multi_event`.

Create a new session with the desired scenario. The `seed` makes meter/forecast data repeatable. `success` yields a synthetic 32 kW relief example; this is deliberately marked `SIMULATED_NOT_FIELD_VERIFIED` and must never be represented as actual savings.

## Endpoints

- `GET /health`
- `GET /api/v1/simulator/scenarios`
- `POST /api/v1/simulator/sessions`
- `GET /api/v1/simulator/sessions/:id`
- `POST /api/v1/simulator/sessions/:id/reset`
- `GET /api/v1/simulator/sessions/:id/consumers`
- `GET /api/v1/simulator/sessions/:id/assets`
- `GET /api/v1/simulator/sessions/:id/meter-readings?limit=96&from=<ISO timestamp>`
- `GET /api/v1/simulator/sessions/:id/forecasts`
- `GET /api/v1/simulator/sessions/:id/events`
- `POST /api/v1/simulator/sessions/:id/events`
- `POST /api/v1/simulator/sessions/:id/events/:eventId/execute`
- `GET /api/v1/simulator/sessions/:id/events/:eventId/mv`
- `GET /api/v1/simulator/sessions/:id/economics`

Responses use a common envelope with `success`, `simulationId`, `scenario`, `generatedAt`, `sourceType`, `data`, and `metadata` where applicable.

## Deploy on Render

1. Push this folder to a new GitHub repository.
2. In Render, select **New + → Blueprint** and connect the repository.
3. Render reads `render.yaml`; review the service settings and deploy.
4. Open `https://YOUR-SERVICE.onrender.com/health` and confirm the response.
5. Set `CORS_ORIGIN` to your frontend origin instead of `*` before sharing beyond local testing.

This service currently stores sessions in memory. Restarting/redeploying clears sessions, and free hosting may sleep when idle. Do not use it for real credentials, personal consumer data, or production dispatch.

## Tests

```bash
npm test
```
