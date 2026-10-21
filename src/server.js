import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8080;
const sessions = new Map();

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const scenarios = [
  { id: 'normal', name: 'Normal operation', description: 'Typical load, valid telemetry and no dispatch event.' },
  { id: 'success', name: 'Successful demand response', description: 'Dispatch succeeds, demand reduces and evidence is complete.' },
  { id: 'dispatch_failure', name: 'Dispatch failure', description: 'Dispatch command times out or is rejected.' },
  { id: 'guardrail_violation', name: 'Guardrail violation attempt', description: 'Unsafe dispatch is blocked and logged.' },
  { id: 'missing_data', name: 'Missing meter data', description: 'Some intervals are missing or flagged invalid.' },
  { id: 'revert_failure', name: 'Revert failure', description: 'Event recovery fails and raises an exception.' },
  { id: 'economic_sensitivity', name: 'Economic sensitivity', description: 'Alternative tariff and cost assumptions.' },
  { id: 'multi_event', name: 'Multiple live-event simulations', description: 'Create multiple distinct simulated events for KPI testing.' }
];

// API-key authentication for simulator endpoints.
// Configure SIMULATOR_API_KEY in Render environment variables.
// Send the same value in the X-API-Key request header.
app.use('/api/v1/simulator', (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const expectedKey = process.env.SIMULATOR_API_KEY;
  const providedKey = req.get('X-API-Key');

  if (!expectedKey) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'API_KEY_NOT_CONFIGURED',
        message: 'Simulator API key is not configured on the server'
      }
    });
  }

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'API_KEY_REQUIRED',
        message: 'Provide the X-API-Key request header'
      }
    });
  }

  const expectedBuffer = Buffer.from(expectedKey, 'utf8');
  const providedBuffer = Buffer.from(providedKey, 'utf8');

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'The supplied API key is invalid'
      }
    });
  }

  next();
});

function envelope(session, data, metadata = {}) {
  return {
    success: true,
    simulationId: session.id,
    scenario: session.scenario,
    generatedAt: now(),
    sourceType: 'SIMULATED',
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
        message: 'Simulation session not found. Create a new session if the service restarted.'
      }
    });
  }

  req.session = session;
  next();
}

function seeded(seed) {
  let x = (Number(seed) || 42) >>> 0;

  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function createSession(body = {}) {
  const session = {
    id: id('sim'),
    createdAt: now(),
    scenario: scenarios.some((item) => item.id === body.scenario)
      ? body.scenario
      : 'normal',
    seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : 42,
    intervalMinutes: [5, 15, 30, 60].includes(Number(body.intervalMinutes))
      ? Number(body.intervalMinutes)
      : 15,
    consumerCount: Math.max(1, Math.min(100, Number(body.consumerCount) || 5)),
    events: [],
    status: 'ACTIVE'
  };

  sessions.set(session.id, session);
  return session;
}

function consumers(session) {
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

  return Array.from({ length: session.consumerCount }, (_, index) => ({
    consumerId: `CON-${String(index + 1).padStart(3, '0')}`,
    siteId: 'SITE-001',
    name: names[index % names.length],
    sector: sectors[index % sectors.length],
    contractDemandKw: 500 + index * 125,
    tariffCategory: 'HT-INDUSTRIAL',
    dataSource: 'SIMULATED',
    sourceType: 'SIMULATED'
  }));
}

function assets() {
  return [
    {
      assetId: 'AST-CH-01',
      siteId: 'SITE-001',
      assetType: 'CHILLER',
      ratedPowerKw: 180,
      flexibleCapacityKw: 45,
      criticality: 'MEDIUM',
      comfortLimits: { minC: 22, maxC: 26 },
      controllable: true,
      sourceType: 'SIMULATED'
    },
    {
      assetId: 'AST-AHU-01',
      siteId: 'SITE-001',
      assetType: 'AHU',
      ratedPowerKw: 75,
      flexibleCapacityKw: 18,
      criticality: 'LOW',
      comfortLimits: { minC: 22, maxC: 26 },
      controllable: true,
      sourceType: 'SIMULATED'
    },
    {
      assetId: 'AST-CMP-01',
      siteId: 'SITE-001',
      assetType: 'COMPRESSOR',
      ratedPowerKw: 120,
      flexibleCapacityKw: 0,
      criticality: 'HIGH',
      comfortLimits: null,
      controllable: false,
      sourceType: 'SIMULATED'
    },
    {
      assetId: 'AST-FAN-01',
      siteId: 'SITE-001',
      assetType: 'VENTILATION_FAN',
      ratedPowerKw: 40,
      flexibleCapacityKw: 10,
      criticality: 'LOW',
      comfortLimits: null,
      controllable: true,
      sourceType: 'SIMULATED'
    }
  ];
}

function meterReadings(session, query = {}) {
  const rng = seeded(session.seed);
  const count = Math.min(2000, Math.max(1, Number(query.limit) || 96));
  const start = new Date(
    query.from || Date.now() - count * session.intervalMinutes * 60000
  );

  const output = [];

  for (let index = 0; index < count; index++) {
    const timestamp = new Date(
      start.getTime() + index * session.intervalMinutes * 60000
    );

    const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
    const peak = hour >= 12 && hour <= 18
      ? 1.25
      : hour >= 8 && hour < 12
        ? 1.05
        : 0.72;

    let kw = 310 * peak + Math.sin(index / 5) * 22 + (rng() - 0.5) * 12;
    let qualityStatus = 'VALID';

    if (session.scenario === 'missing_data' && index % 17 === 0) {
      qualityStatus = 'MISSING';
      kw = null;
    }

    output.push({
      readingId: `RD-${session.seed}-${index + 1}`,
      consumerId: 'CON-001',
      siteId: 'SITE-001',
      timestamp: timestamp.toISOString(),
      intervalMinutes: session.intervalMinutes,
      powerKw: kw === null ? null : Number(kw.toFixed(2)),
      energyKwh: kw === null
        ? null
        : Number((kw * session.intervalMinutes / 60).toFixed(3)),
      qualityStatus,
      unitPower: 'kW',
      unitEnergy: 'kWh',
      sourceType: 'SIMULATED',
      validationStatus: 'SIMULATED_NOT_FIELD_VERIFIED'
    });
  }

  return output;
}

function forecasts(session) {
  const rng = seeded(session.seed + 1);

  return Array.from({ length: 24 }, (_, index) => {
    const timestamp = new Date();
    timestamp.setHours(index, 0, 0, 0);

    const kw = 310
      + (index >= 12 && index <= 18 ? 90 : 0)
      + Math.sin(index / 3) * 20
      + (rng() - 0.5) * 10;

    return {
      forecastId: `FC-${session.seed}-${index + 1}`,
      siteId: 'SITE-001',
      timestamp: timestamp.toISOString(),
      predictedPowerKw: Number(kw.toFixed(2)),
      lowerBoundKw: Number((kw - 18).toFixed(2)),
      upperBoundKw: Number((kw + 18).toFixed(2)),
      modelVersion: 'sim-1.0',
      sourceType: 'SIMULATED',
      validationStatus: 'SIMULATED_NOT_FIELD_VERIFIED'
    };
  });
}

function eventMv(session, event) {
  const baseline = 320;
  const reduction = session.scenario === 'success'
    ? 32
    : session.scenario === 'guardrail_violation'
      ? 0
      : 12;

  const actual = baseline - reduction;
  const valid = session.scenario !== 'missing_data';

  return {
    eventId: event.eventId,
    baselineMethod: 'SIMULATED_FIXED_BASELINE_V1',
    baselinePowerKw: baseline,
    actualPowerKw: actual,
    reliefKw: valid ? Number((baseline - actual).toFixed(2)) : null,
    reliefPercent: valid
      ? Number(((baseline - actual) / baseline * 100).toFixed(2))
      : null,
    energyReductionKwh: valid
      ? Number((reduction * (event.durationMinutes || 60) / 60).toFixed(2))
      : null,
    reboundEnergyKwh: valid ? 4.5 : null,
    dataQuality: valid ? 'VALID' : 'INCOMPLETE',
    evidenceStatus: valid ? 'PROVISIONAL' : 'INCOMPLETE',
    validationStatus: 'SIMULATED_NOT_FIELD_VERIFIED',
    sourceType: 'SIMULATED'
  };
}

// Health endpoint intentionally remains public.
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'adr-kpi-simulator',
    status: 'ok',
    version: '1.0.0',
    sourceType: 'SIMULATED',
    timestamp: now()
  });
});

// A protected base route for integrations that test the configured base URL.
app.get('/api/v1/simulator', (req, res) => {
  res.json({
    success: true,
    service: 'adr-kpi-simulator',
    status: 'ok',
    sourceType: 'SIMULATED',
    availableEndpoints: [
      '/scenarios',
      '/sessions',
      '/sessions/:id',
      '/sessions/:id/consumers',
      '/sessions/:id/assets',
      '/sessions/:id/meter-readings',
      '/sessions/:id/forecasts',
      '/sessions/:id/events',
      '/sessions/:id/economics'
    ]
  });
});

app.get('/api/v1/simulator/scenarios', (req, res) => {
  res.json({
    success: true,
    sourceType: 'SIMULATED',
    data: scenarios
  });
});

app.post('/api/v1/simulator/sessions', (req, res) => {
  const session = createSession(req.body || {});

  res.status(201).json(
    envelope(session, {
      session: {
        id: session.id,
        scenario: session.scenario,
        seed: session.seed,
        intervalMinutes: session.intervalMinutes,
        consumerCount: session.consumerCount,
        status: session.status,
        createdAt: session.createdAt
      }
    })
  );
});

app.get('/api/v1/simulator/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'Simulation session not found'
      }
    });
  }

  res.json(envelope(session, {
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
  res.json(envelope(req.session, { reset: true, eventCount: 0 }));
});

app.get('/api/v1/simulator/sessions/:id/consumers', getSession, (req, res) => {
  const data = consumers(req.session);
  res.json(envelope(req.session, data, { count: data.length }));
});

app.get('/api/v1/simulator/sessions/:id/assets', getSession, (req, res) => {
  const data = assets();
  res.json(envelope(req.session, data, { count: data.length }));
});

app.get('/api/v1/simulator/sessions/:id/meter-readings', getSession, (req, res) => {
  const data = meterReadings(req.session, req.query);

  res.json(envelope(req.session, data, {
    count: data.length,
    intervalMinutes: req.session.intervalMinutes,
    units: { power: 'kW', energy: 'kWh' }
  }));
});

app.get('/api/v1/simulator/sessions/:id/forecasts', getSession, (req, res) => {
  const data = forecasts(req.session);
  res.json(envelope(req.session, data, {
    count: data.length,
    units: { power: 'kW' }
  }));
});

app.get('/api/v1/simulator/sessions/:id/events', getSession, (req, res) => {
  res.json(envelope(req.session, req.session.events, {
    count: req.session.events.length
  }));
});

app.post('/api/v1/simulator/sessions/:id/events', getSession, (req, res) => {
  const body = req.body || {};

  const event = {
    eventId: id('evt'),
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
    sourceType: 'SIMULATED'
  };

  req.session.events.push(event);
  res.status(201).json(envelope(req.session, event));
});

app.post(
  '/api/v1/simulator/sessions/:id/events/:eventId/execute',
  getSession,
  (req, res) => {
    const session = req.session;
    const event = session.events.find(
      (item) => item.eventId === req.params.eventId
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'Event not found in this session'
        }
      });
    }

    const scenario = session.scenario;
    const failed = scenario === 'dispatch_failure';
    const violation = scenario === 'guardrail_violation';
    const revertFailed = scenario === 'revert_failure';

    event.eventStatus = failed
      ? 'FAILED'
      : violation
        ? 'BLOCKED'
        : 'COMPLETED';

    event.dispatchStatus = failed
      ? 'TIMEOUT'
      : violation
        ? 'BLOCKED_BY_GUARDRAIL'
        : 'ACKNOWLEDGED';

    event.guardrailStatus = violation ? 'VIOLATION_BLOCKED' : 'WITHIN_LIMITS';
    event.overrideActivated = false;
    event.revertStatus = revertFailed ? 'FAILED' : 'SUCCEEDED';
    event.executedAt = now();
    event.validationStatus = 'SIMULATED_NOT_FIELD_VERIFIED';
    event.mv = eventMv(session, event);
    event.evidenceStatus = scenario === 'missing_data'
      ? 'INCOMPLETE'
      : 'PROVISIONAL';

    res.json(envelope(session, event));
  }
);

app.get(
  '/api/v1/simulator/sessions/:id/events/:eventId/mv',
  getSession,
  (req, res) => {
    const event = req.session.events.find(
      (item) => item.eventId === req.params.eventId
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'Event not found in this session'
        }
      });
    }

    res.json(envelope(
      req.session,
      event.mv || eventMv(req.session, event)
    ));
  }
);

app.get('/api/v1/simulator/sessions/:id/economics', getSession, (req, res) => {
  const session = req.session;
  const factor = session.scenario === 'economic_sensitivity' ? 1.25 : 1;

  res.json(envelope(session, {
    tariffId: 'TARIFF-SIM-01',
    currency: 'INR',
    peakRatePerKwh: Number((9.5 * factor).toFixed(2)),
    offPeakRatePerKwh: 5.2,
    avoidedCostPerKwh: Number((7.8 * factor).toFixed(2)),
    integrationCostInr: 150000,
    annualOperatingCostInr: 60000,
    programmeCostInr: 210000,
    assumptionStatus: 'SIMULATED_ASSUMPTIONS_ONLY',
    sourceType: 'SIMULATED'
  }));
});

// JSON response for unknown routes.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`
    }
  });
});

// JSON response for unexpected errors.
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected simulator error'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ADR simulator listening on ${PORT}`);
});
