
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

const sessions = new Map();

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const scenarios = [
  { id: 'normal', name: 'Normal operation', description: 'Typical load and valid simulated telemetry.' },
  { id: 'success', name: 'Successful demand response', description: 'Simulated dispatch succeeds with provisional evidence.' },
  { id: 'dispatch_failure', name: 'Dispatch failure', description: 'Simulated dispatch command fails.' },
  { id: 'guardrail_violation', name: 'Guardrail violation', description: 'Unsafe simulated dispatch is blocked.' },
  { id: 'missing_data', name: 'Missing meter data', description: 'Some simulated intervals are missing.' },
  { id: 'revert_failure', name: 'Revert failure', description: 'Simulated recovery fails.' },
  { id: 'economic_sensitivity', name: 'Economic sensitivity', description: 'Alternative simulated economic assumptions.' },
  { id: 'multi_event', name: 'Multiple events', description: 'Multiple simulated demand-response events.' }
];

const SIMULATED = 'SIMULATED';
const NOT_VERIFIED = 'SIMULATED_NOT_FIELD_VERIFIED';

// Public health endpoint is defined below, outside the protected API prefix.
// All /api/v1/simulator routes require the configured API key.
app.use('/api/v1/simulator', (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const expectedKey = process.env.SIMULATOR_API_KEY;
  const suppliedKey = req.get('X-API-Key');

  if (!expectedKey) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'API_KEY_NOT_CONFIGURED',
        message: 'Simulator API key is not configured on the server.'
      }
    });
  }

  if (!suppliedKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'API_KEY_REQUIRED',
        message: 'Provide the X-API-Key request header.'
      }
    });
  }

  const expected = Buffer.from(expectedKey, 'utf8');
  const supplied = Buffer.from(suppliedKey, 'utf8');

  if (
    expected.length !== supplied.length ||
    !crypto.timingSafeEqual(expected, supplied)
  ) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'The supplied API key is invalid.'
      }
    });
  }

  next();
});

function responseEnvelope(session, data, metadata = {}) {
  return {
    success: true,
    simulationId: session.id,
    scenario: session.scenario,
    generatedAt: now(),
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED,
    data,
    metadata
  };
}

function getSession(req, res, next) {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Simulation session not found. Create a new session after a service restart.'
      }
    });
  }

  req.session = session;
  next();
}

function createSession(body = {}) {
  const requestedScenario = String(body.scenario || 'normal');

  const session = {
    id: makeId('sim'),
    createdAt: now(),
    scenario: scenarios.some((s) => s.id === requestedScenario)
      ? requestedScenario
      : 'normal',
    seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : 42,
    intervalMinutes: [5, 15, 30, 60].includes(Number(body.intervalMinutes))
      ? Number(body.intervalMinutes)
      : 15,
    consumerCount: Math.max(
      1,
      Math.min(100, Number(body.consumerCount) || 5)
    ),
    events: [],
    status: 'ACTIVE'
  };

  sessions.set(session.id, session);
  return session;
}

function seededRandom(seed) {
  let value = (Number(seed) || 42) >>> 0;

  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function getConsumers(session) {
  const names = [
    'Marudhar Industries',
    'Central Cold Storage',
    'Narmada Packaging',
    'Indore Components',
    'Malwa Foods'
  ];

  const sectors = [
    'Manufacturing',
    'Cold storage',
    'Packaging',
    'Automotive',
    'Food processing'
  ];

  return Array.from({ length: session.consumerCount }, (_, i) => ({
    consumerId: `CON-${String(i + 1).padStart(3, '0')}`,
    meterId: i === 0 ? '23102045' : `SIM-METER-${String(i + 1).padStart(3, '0')}`,
    siteId: 'SITE-001',
    name: names[i % names.length],
    sector: sectors[i % sectors.length],
    contractDemandKw: 500 + i * 125,
    tariffCategory: 'HT-INDUSTRIAL',
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED
  }));
}

function getAssets() {
  return [
    {
      assetId: 'AST-CH-01',
      siteId: 'SITE-001',
      assetType: 'CHILLER',
      ratedPowerKw: 180,
      flexibleCapacityKw: 45,
      criticality: 'MEDIUM',
      controllable: true,
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    },
    {
      assetId: 'AST-AHU-01',
      siteId: 'SITE-001',
      assetType: 'AHU',
      ratedPowerKw: 75,
      flexibleCapacityKw: 18,
      criticality: 'LOW',
      controllable: true,
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    },
    {
      assetId: 'AST-CMP-01',
      siteId: 'SITE-001',
      assetType: 'COMPRESSOR',
      ratedPowerKw: 120,
      flexibleCapacityKw: 0,
      criticality: 'HIGH',
      controllable: false,
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    },
    {
      assetId: 'AST-FAN-01',
      siteId: 'SITE-001',
      assetType: 'VENTILATION_FAN',
      ratedPowerKw: 40,
      flexibleCapacityKw: 10,
      criticality: 'LOW',
      controllable: true,
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    }
  ];
}

function buildReadings({
  meterId = '23102045',
  start = new Date(Date.now() - 24 * 60 * 60 * 1000),
  end = new Date(),
  intervalMinutes = 15,
  seed = 42,
  scenario = 'normal',
  limit = 672
} = {}) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate < startDate
  ) {
    return null;
  }

  const random = seededRandom(seed);
  const intervalMs = intervalMinutes * 60 * 1000;
  const count = Math.min(
    limit,
    Math.floor((endDate.getTime() - startDate.getTime()) / intervalMs) + 1
  );

  const readings = [];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(startDate.getTime() + i * intervalMs);
    const hour = timestamp.getHours() + timestamp.getMinutes() / 60;

    const peakFactor =
      hour >= 12 && hour < 19 ? 1.25 :
      hour >= 8 && hour < 12 ? 1.05 :
      0.72;

    let powerKw =
      286.4 * peakFactor +
      Math.sin(i / 5) * 8 +
      (random() - 0.5) * 6;

    let qualityStatus = 'VALID';

    if (scenario === 'missing_data' && i % 17 === 0) {
      powerKw = null;
      qualityStatus = 'MISSING';
    }

    const energyKwh = powerKw === null
      ? null
      : Number((powerKw * intervalMinutes / 60).toFixed(3));

    readings.push({
      readingId: `RD-${seed}-${i + 1}`,
      meterId: String(meterId),
      meterID: String(meterId),
      timestamp: timestamp.toISOString(),
      readingTime: timestamp.toISOString(),
      intervalMinutes,
      powerKw: powerKw === null ? null : Number(powerKw.toFixed(2)),
      activePowerKw: powerKw === null ? null : Number(powerKw.toFixed(2)),
      energyKwh,
      kWh: energyKwh,
      voltage: 415.2,
      voltageV: 415.2,
      current: 398.5,
      currentA: 398.5,
      frequencyHz: 50,
      powerFactor: 0.96,
      qualityStatus,
      unitPower: 'kW',
      unitEnergy: 'kWh',
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    });
  }

  return readings;
}

function getSessionReadings(session, query = {}) {
  const limit = Math.min(2000, Math.max(1, Number(query.limit) || 96));
  const start = query.from || query.startTime ||
    new Date(Date.now() - limit * session.intervalMinutes * 60000);

  const end = query.endTime || new Date(
    new Date(start).getTime() +
    (limit - 1) * session.intervalMinutes * 60000
  );

  return buildReadings({
    meterId: query.meterID || query.meterId || '23102045',
    start,
    end,
    intervalMinutes: session.intervalMinutes,
    seed: session.seed,
    scenario: session.scenario,
    limit
  }) || [];
}

function getForecasts(session) {
  const random = seededRandom(session.seed + 1);

  return Array.from({ length: 24 }, (_, i) => {
    const timestamp = new Date();
    timestamp.setHours(i, 0, 0, 0);

    const predictedPowerKw =
      310 +
      (i >= 12 && i <= 18 ? 90 : 0) +
      Math.sin(i / 3) * 20 +
      (random() - 0.5) * 10;

    return {
      forecastId: `FC-${session.seed}-${i + 1}`,
      siteId: 'SITE-001',
      timestamp: timestamp.toISOString(),
      predictedPowerKw: Number(predictedPowerKw.toFixed(2)),
      lowerBoundKw: Number((predictedPowerKw - 18).toFixed(2)),
      upperBoundKw: Number((predictedPowerKw + 18).toFixed(2)),
      modelVersion: 'sim-1.0',
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    };
  });
}

function calculateEventMv(session, event) {
  const baselinePowerKw = 320;

  const reliefKw = session.scenario === 'success'
    ? 32
    : session.scenario === 'guardrail_violation'
      ? 0
      : 12;

  const hasValidData = session.scenario !== 'missing_data';
  const actualPowerKw = baselinePowerKw - reliefKw;

  return {
    eventId: event.eventId,
    baselineMethod: 'SIMULATED_FIXED_BASELINE_V1',
    baselinePowerKw,
    actualPowerKw,
    reliefKw: hasValidData ? reliefKw : null,
    reliefPercent: hasValidData
      ? Number((reliefKw / baselinePowerKw * 100).toFixed(2))
      : null,
    energyReductionKwh: hasValidData
      ? Number((reliefKw * (event.durationMinutes || 60) / 60).toFixed(2))
      : null,
    dataQuality: hasValidData ? 'VALID' : 'INCOMPLETE',
    evidenceStatus: hasValidData ? 'PROVISIONAL' : 'INCOMPLETE',
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED
  };
}

function findSessionEvent(session, eventId) {
  return session.events.find((event) => event.eventId === eventId);
}

function parseDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// -----------------------------------------------------------------------------
// Public health endpoint
// -----------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'adr-kpi-simulator',
    status: 'ok',
    version: '1.0.0',
    sourceType: SIMULATED,
    timestamp: now()
  });
});

// -----------------------------------------------------------------------------
// Protected API root and scenarios
// -----------------------------------------------------------------------------

app.get('/api/v1/simulator', (req, res) => {
  res.json({
    success: true,
    service: 'adr-kpi-simulator',
    status: 'ok',
    sourceType: SIMULATED,
    availableEndpoints: [
      '/scenarios',
      '/sessions',
      '/sessions/:id',
      '/sessions/:id/consumers',
      '/sessions/:id/assets',
      '/sessions/:id/meter-readings',
      '/sessions/:id/forecasts',
      '/sessions/:id/events',
      '/sessions/:id/economics',
      '/metering/readings/latest/:meterID',
      '/metering/readings/interval',
      '/metering/events/:meterID',
      '/billing/cycle-data/:meterID'
    ]
  });
});

app.get('/api/v1/simulator/scenarios', (req, res) => {
  res.json({
    success: true,
    sourceType: SIMULATED,
    data: scenarios
  });
});

// -----------------------------------------------------------------------------
// Session management
// -----------------------------------------------------------------------------

app.post('/api/v1/simulator/sessions', (req, res) => {
  const session = createSession(req.body || {});

  res.status(201).json(responseEnvelope(session, {
    session: {
      id: session.id,
      scenario: session.scenario,
      seed: session.seed,
      intervalMinutes: session.intervalMinutes,
      consumerCount: session.consumerCount,
      status: session.status,
      createdAt: session.createdAt
    }
  }));
});

app.get('/api/v1/simulator/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Simulation session not found.'
      }
    });
  }

  res.json(responseEnvelope(session, {
    session: {
      id: session.id,
      scenario: session.scenario,
      seed: session.seed,
      intervalMinutes: session.intervalMinutes,
      consumerCount: session.consumerCount,
      status: session.status,
      createdAt: session.createdAt,
      eventCount: session.events.length
    }
  }));
});

app.post('/api/v1/simulator/sessions/:id/reset', getSession, (req, res) => {
  req.session.events = [];
  res.json(responseEnvelope(req.session, {
    reset: true,
    eventCount: 0
  }));
});

app.get('/api/v1/simulator/sessions/:id/consumers', getSession, (req, res) => {
  const data = getConsumers(req.session);
  res.json(responseEnvelope(req.session, data, { count: data.length }));
});

app.get('/api/v1/simulator/sessions/:id/assets', getSession, (req, res) => {
  const data = getAssets();
  res.json(responseEnvelope(req.session, data, { count: data.length }));
});

app.get('/api/v1/simulator/sessions/:id/meter-readings', getSession, (req, res) => {
  const data = getSessionReadings(req.session, req.query);

  res.json(responseEnvelope(req.session, data, {
    count: data.length,
    intervalMinutes: req.session.intervalMinutes,
    units: { power: 'kW', energy: 'kWh' }
  }));
});

app.get('/api/v1/simulator/sessions/:id/forecasts', getSession, (req, res) => {
  const data = getForecasts(req.session);

  res.json(responseEnvelope(req.session, data, {
    count: data.length,
    units: { power: 'kW' }
  }));
});

// -----------------------------------------------------------------------------
// Demand-response events and M&V
// -----------------------------------------------------------------------------

app.get('/api/v1/simulator/sessions/:id/events', getSession, (req, res) => {
  res.json(responseEnvelope(req.session, req.session.events, {
    count: req.session.events.length
  }));
});

app.post('/api/v1/simulator/sessions/:id/events', getSession, (req, res) => {
  const body = req.body || {};

  const event = {
    eventId: makeId('evt'),
    siteId: body.siteId || 'SITE-001',
    targetReductionKw: Math.max(0, Number(body.targetReductionKw) || 25),
    startTime: body.startTime || now(),
    durationMinutes: Math.max(
      15,
      Math.min(240, Number(body.durationMinutes) || 60)
    ),
    eventStatus: 'PLANNED',
    dispatchStatus: 'NOT_ATTEMPTED',
    createdAt: now(),
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED
  };

  req.session.events.push(event);

  res.status(201).json(responseEnvelope(req.session, event));
});

app.post(
  '/api/v1/simulator/sessions/:id/events/:eventId/execute',
  getSession,
  (req, res) => {
    const session = req.session;
    const event = findSessionEvent(session, req.params.eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'Event not found in this session.'
        }
      });
    }

    const scenario = session.scenario;
    const dispatchFailed = scenario === 'dispatch_failure';
    const guardrailBlocked = scenario === 'guardrail_violation';
    const revertFailed = scenario === 'revert_failure';

    event.eventStatus = dispatchFailed
      ? 'FAILED'
      : guardrailBlocked
        ? 'BLOCKED'
        : 'COMPLETED';

    event.dispatchStatus = dispatchFailed
      ? 'TIMEOUT'
      : guardrailBlocked
        ? 'BLOCKED_BY_GUARDRAIL'
        : 'ACKNOWLEDGED';

    event.guardrailStatus = guardrailBlocked
      ? 'VIOLATION_BLOCKED'
      : 'WITHIN_LIMITS';

    event.overrideActivated = false;
    event.revertStatus = revertFailed ? 'FAILED' : 'SUCCEEDED';
    event.executedAt = now();
    event.mv = calculateEventMv(session, event);
    event.evidenceStatus = scenario === 'missing_data'
      ? 'INCOMPLETE'
      : 'PROVISIONAL';

    res.json(responseEnvelope(session, event));
  }
);

app.get(
  '/api/v1/simulator/sessions/:id/events/:eventId/mv',
  getSession,
  (req, res) => {
    const event = findSessionEvent(req.session, req.params.eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'Event not found in this session.'
        }
      });
    }

    res.json(responseEnvelope(
      req.session,
      event.mv || calculateEventMv(req.session, event)
    ));
  }
);

app.get('/api/v1/simulator/sessions/:id/economics', getSession, (req, res) => {
  const sensitivity =
    req.session.scenario === 'economic_sensitivity' ? 1.25 : 1;

  res.json(responseEnvelope(req.session, {
    tariffId: 'TARIFF-SIM-01',
    currency: 'INR',
    peakRatePerKwh: Number((9.5 * sensitivity).toFixed(2)),
    offPeakRatePerKwh: 5.2,
    avoidedCostPerKwh: Number((7.8 * sensitivity).toFixed(2)),
    integrationCostInr: 150000,
    annualOperatingCostInr: 60000,
    programmeCostInr: 210000,
    assumptionStatus: 'SIMULATED_ASSUMPTIONS_ONLY',
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED
  }));
});

// -----------------------------------------------------------------------------
// MDMS compatibility: latest reading
// GET /metering/readings/latest/:meterID
// -----------------------------------------------------------------------------

app.get(
  '/api/v1/simulator/metering/readings/latest/:meterID',
  (req, res) => {
    const meterID = req.params.meterID;
    const timestamp = now();

    const reading = {
      readingId: `MDMS-${meterID}-${Date.now()}`,
      meterId: meterID,
      meterID,
      timestamp,
      readingTime: timestamp,
      activeEnergyKwh: 12543.75,
      energyKwh: 12543.75,
      kWh: 12543.75,
      powerKw: 286.4,
      activePowerKw: 286.4,
      voltage: 415.2,
      voltageV: 415.2,
      current: 398.5,
      currentA: 398.5,
      frequencyHz: 50,
      powerFactor: 0.96,
      unit: 'kWh',
      qualityStatus: 'SIMULATED',
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    };

    res.json({
      success: true,
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED,
      meterId: meterID,
      data: reading,
      reading
    });
  }
);

// -----------------------------------------------------------------------------
// MDMS compatibility: interval/load profile
// GET /metering/readings/interval?meterID=...&startTime=...&endTime=...
// -----------------------------------------------------------------------------

app.get('/api/v1/simulator/metering/readings/interval', (req, res) => {
  const meterID = String(
    req.query.meterID || req.query.meterId || '23102045'
  );

  const start = parseDate(
    req.query.startTime || req.query.from,
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );

  const end = parseDate(
    req.query.endTime || req.query.to,
    new Date()
  );

  if (!start || !end || end < start) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DATE_RANGE',
        message: 'Provide valid startTime and endTime values.'
      }
    });
  }

  const readings = buildReadings({
    meterId: meterID,
    start,
    end,
    intervalMinutes: 15,
    seed: 42,
    scenario: 'normal',
    limit: 672
  });

  res.json({
    success: true,
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED,
    meterId: meterID,
    intervalMinutes: 15,
    count: readings.length,
    data: readings,
    readings
  });
});

// -----------------------------------------------------------------------------
// MDMS compatibility: meter events
// GET /metering/events/:meterID
// -----------------------------------------------------------------------------

app.get('/api/v1/simulator/metering/events/:meterID', (req, res) => {
  const meterID = req.params.meterID;

  const events = [
    {
      eventId: 'SIM-EVENT-001',
      meterId: meterID,
      timestamp: now(),
      eventType: 'DEMAND_RESPONSE_TEST',
      description: 'Synthetic simulator event',
      status: 'SIMULATED',
      sourceType: SIMULATED,
      validationStatus: NOT_VERIFIED
    }
  ];

  res.json({
    success: true,
    sourceType: SIMULATED,
    meterId: meterID,
    count: events.length,
    data: events,
    events
  });
});

// -----------------------------------------------------------------------------
// MDMS compatibility: billing-cycle snapshot
// GET /billing/cycle-data/:meterID
// -----------------------------------------------------------------------------

app.get('/api/v1/simulator/billing/cycle-data/:meterID', (req, res) => {
  const meterID = req.params.meterID;

  const billing = {
    meterId: meterID,
    billingPeriod: new Date().toISOString().slice(0, 7),
    energyConsumedKwh: 12543.75,
    peakDemandKw: 286.4,
    estimatedAmountInr: 108250.50,
    currency: 'INR',
    billingStatus: 'SIMULATED_ESTIMATE',
    sourceType: SIMULATED,
    validationStatus: NOT_VERIFIED
  };

  res.json({
    success: true,
    sourceType: SIMULATED,
    meterId: meterID,
    data: billing,
    billing
  });
});

// -----------------------------------------------------------------------------
// Unknown routes
// Keep this LAST so it does not intercept valid routes.
// -----------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Simulator error:', err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected simulator error.'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ADR KPI Simulator listening on port ${PORT}`);
});
