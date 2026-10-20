import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*'}));
app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 8080;
const sessions = new Map();
const scenarios = [
  { id:'normal', name:'Normal operation', description:'Typical load, valid telemetry and no dispatch event.' },
  { id:'success', name:'Successful demand response', description:'Dispatch succeeds, demand reduces and evidence is complete.' },
  { id:'dispatch_failure', name:'Dispatch failure', description:'Dispatch command times out or is rejected.' },
  { id:'guardrail_violation', name:'Guardrail violation attempt', description:'Unsafe dispatch is blocked and logged.' },
  { id:'missing_data', name:'Missing meter data', description:'Some intervals are missing or flagged invalid.' },
  { id:'revert_failure', name:'Revert failure', description:'Event recovery fails and raises an exception.' },
  { id:'economic_sensitivity', name:'Economic sensitivity', description:'Alternative tariff and cost assumptions.' },
  { id:'multi_event', name:'Multiple live-event simulations', description:'Create multiple distinct simulated events for KPI testing.' }
];
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
function envelope(session, data, metadata = {}) { return { success:true, simulationId:session.id, scenario:session.scenario, generatedAt:now(), sourceType:'SIMULATED', data, metadata }; }
function getSession(req,res,next) { const s=sessions.get(req.params.id); if(!s) return res.status(404).json({success:false,error:{code:'SESSION_NOT_FOUND',message:'Simulation session not found'}}); req.session=s; next(); }
function seeded(seed) { let x = (Number(seed)||42) >>> 0; return () => { x = (1664525*x + 1013904223) >>> 0; return x / 4294967296; }; }
function createSession(body={}) {
  const s={ id:id('sim'), createdAt:now(), scenario:scenarios.some(x=>x.id===body.scenario)?body.scenario:'normal', seed:Number.isFinite(Number(body.seed))?Number(body.seed):42, intervalMinutes:[5,15,30,60].includes(Number(body.intervalMinutes))?Number(body.intervalMinutes):15, consumerCount:Math.max(1,Math.min(100,Number(body.consumerCount)||5)), events:[], status:'ACTIVE' };
  sessions.set(s.id,s); return s;
}
function consumers(s) { return Array.from({length:s.consumerCount},(_,i)=>({consumerId:`CON-${String(i+1).padStart(3,'0')}`,siteId:'SITE-001',name:['Marudhar Industries','Central Cold Storage','Narmada Packaging','Indore Components','Malwa Foods'][i%5],sector:['Manufacturing','Cold storage','Packaging','Automotive','Food processing'][i%5],contractDemandKw:500+(i*125),tariffCategory:'HT-INDUSTRIAL',dataSource:'SIMULATED'})); }
function assets() { return [
 {assetId:'AST-CH-01',siteId:'SITE-001',assetType:'CHILLER',ratedPowerKw:180,flexibleCapacityKw:45,criticality:'MEDIUM',comfortLimits:{minC:22,maxC:26},controllable:true},
 {assetId:'AST-AHU-01',siteId:'SITE-001',assetType:'AHU',ratedPowerKw:75,flexibleCapacityKw:18,criticality:'LOW',comfortLimits:{minC:22,maxC:26},controllable:true},
 {assetId:'AST-CMP-01',siteId:'SITE-001',assetType:'COMPRESSOR',ratedPowerKw:120,flexibleCapacityKw:0,criticality:'HIGH',comfortLimits:null,controllable:false},
 {assetId:'AST-FAN-01',siteId:'SITE-001',assetType:'VENTILATION_FAN',ratedPowerKw:40,flexibleCapacityKw:10,criticality:'LOW',comfortLimits:null,controllable:true}
]; }
function meterReadings(s, query={}) { const rng=seeded(s.seed); const count=Math.min(2000,Math.max(1,Number(query.limit)||96)); const start=new Date(query.from || Date.now()-count*s.intervalMinutes*60000); const out=[]; for(let i=0;i<count;i++){const t=new Date(start.getTime()+i*s.intervalMinutes*60000); const hour=t.getHours()+t.getMinutes()/60; const peak=hour>=12&&hour<=18?1.25:hour>=8&&hour<12?1.05:.72; let kw=310*peak+Math.sin(i/5)*22+(rng()-.5)*12; let qualityStatus='VALID'; if(s.scenario==='missing_data' && i%17===0){qualityStatus='MISSING';kw=null;} out.push({readingId:`RD-${s.seed}-${i+1}`,consumerId:'CON-001',siteId:'SITE-001',timestamp:t.toISOString(),intervalMinutes:s.intervalMinutes,powerKw:kw===null?null:Number(kw.toFixed(2)),energyKwh:kw===null?null:Number((kw*s.intervalMinutes/60).toFixed(3)),qualityStatus,unitPower:'kW',unitEnergy:'kWh',sourceType:'SIMULATED'});} return out; }
function forecasts(s) { const rng=seeded(s.seed+1); return Array.from({length:24},(_,i)=>{const t=new Date();t.setHours(i,0,0,0);const kw=310+(i>=12&&i<=18?90:0)+Math.sin(i/3)*20+(rng()-.5)*10;return {forecastId:`FC-${s.seed}-${i+1}`,siteId:'SITE-001',timestamp:t.toISOString(),predictedPowerKw:Number(kw.toFixed(2)),lowerBoundKw:Number((kw-18).toFixed(2)),upperBoundKw:Number((kw+18).toFixed(2)),modelVersion:'sim-1.0',sourceType:'SIMULATED'};}); }
function eventMv(s,e) { const baseline=320, reduction=s.scenario==='success'?32:s.scenario==='guardrail_violation'?0:12, actual=baseline-reduction; const valid=!['missing_data'].includes(s.scenario); return {eventId:e.eventId,baselineMethod:'SIMULATED_FIXED_BASELINE_V1',baselinePowerKw:baseline,actualPowerKw:actual,reliefKw:valid?Number((baseline-actual).toFixed(2)):null,reliefPercent:valid?Number(((baseline-actual)/baseline*100).toFixed(2)):null,energyReductionKwh:valid?Number((reduction*(e.durationMinutes||60)/60).toFixed(2)):null,reboundEnergyKwh:valid?4.5:null,dataQuality:valid?'VALID':'INCOMPLETE',evidenceStatus:valid?'PROVISIONAL':'INCOMPLETE',validationStatus:'SIMULATED_NOT_FIELD_VERIFIED',sourceType:'SIMULATED'}; }
app.get('/health',(req,res)=>res.json({success:true,service:'adr-kpi-simulator',status:'ok',version:'1.0.0',sourceType:'SIMULATED',timestamp:now()}));
app.get('/api/v1/simulator/scenarios',(req,res)=>res.json({success:true,data:scenarios}));
app.post('/api/v1/simulator/sessions',(req,res)=>{const s=createSession(req.body||{});res.status(201).json(envelope(s,{session:{id:s.id,scenario:s.scenario,seed:s.seed,intervalMinutes:s.intervalMinutes,consumerCount:s.consumerCount,status:s.status,createdAt:s.createdAt}}));});
app.get('/api/v1/simulator/sessions/:id',(req,res,next)=>{const s=sessions.get(req.params.id);if(!s)return res.status(404).json({success:false,error:{code:'SESSION_NOT_FOUND',message:'Simulation session not found'}});res.json(envelope(s,{session:{id:s.id,scenario:s.scenario,seed:s.seed,intervalMinutes:s.intervalMinutes,consumerCount:s.consumerCount,status:s.status,createdAt:s.createdAt,eventCount:s.events.length}}));});
app.post('/api/v1/simulator/sessions/:id/reset',getSession,(req,res)=>{req.session.events=[];res.json(envelope(req.session,{reset:true,eventCount:0}));});
app.get('/api/v1/simulator/sessions/:id/consumers',getSession,(req,res)=>res.json(envelope(req.session,consumers(req.session),{count:req.session.consumerCount})));
app.get('/api/v1/simulator/sessions/:id/assets',getSession,(req,res)=>res.json(envelope(req.session,assets(),{count:assets().length})));
app.get('/api/v1/simulator/sessions/:id/meter-readings',getSession,(req,res)=>{const d=meterReadings(req.session,req.query);res.json(envelope(req.session,d,{count:d.length,intervalMinutes:req.session.intervalMinutes,units:{power:'kW',energy:'kWh'}}));});
app.get('/api/v1/simulator/sessions/:id/forecasts',getSession,(req,res)=>{const d=forecasts(req.session);res.json(envelope(req.session,d,{count:d.length,units:{power:'kW'}}));});
app.get('/api/v1/simulator/sessions/:id/events',getSession,(req,res)=>res.json(envelope(req.session,req.session.events,{count:req.session.events.length})));
app.post('/api/v1/simulator/sessions/:id/events',getSession,(req,res)=>{const body=req.body||{};const e={eventId:id('evt'),siteId:body.siteId||'SITE-001',targetReductionKw:Math.max(0,Number(body.targetReductionKw)||25),startTime:body.startTime||now(),durationMinutes:Math.max(15,Math.min(240,Number(body.durationMinutes)||60)),eventStatus:'PLANNED',dispatchStatus:'NOT_ATTEMPTED',createdAt:now(),sourceType:'SIMULATED'};req.session.events.push(e);res.status(201).json(envelope(req.session,e));});
app.post('/api/v1/simulator/sessions/:id/events/:eventId/execute',getSession,(req,res)=>{const s=req.session,e=s.events.find(x=>x.eventId===req.params.eventId);if(!e)return res.status(404).json({success:false,error:{code:'EVENT_NOT_FOUND',message:'Event not found in this session'}});const sc=s.scenario;const failed=sc==='dispatch_failure';const violation=sc==='guardrail_violation';const revertFailed=sc==='revert_failure';e.eventStatus=failed?'FAILED':violation?'BLOCKED': 'COMPLETED';e.dispatchStatus=failed?'TIMEOUT':violation?'BLOCKED_BY_GUARDRAIL':'ACKNOWLEDGED';e.guardrailStatus=violation?'VIOLATION_BLOCKED':'WITHIN_LIMITS';e.overrideActivated=false;e.revertStatus=revertFailed?'FAILED': 'SUCCEEDED';e.executedAt=now();e.validationStatus='SIMULATED_NOT_FIELD_VERIFIED';e.mv=eventMv(s,e);e.evidenceStatus=sc==='missing_data'?'INCOMPLETE':'PROVISIONAL';res.json(envelope(s,e));});
app.get('/api/v1/simulator/sessions/:id/events/:eventId/mv',getSession,(req,res)=>{const e=req.session.events.find(x=>x.eventId===req.params.eventId);if(!e)return res.status(404).json({success:false,error:{code:'EVENT_NOT_FOUND',message:'Event not found in this session'}});res.json(envelope(req.session,e.mv||eventMv(req.session,e)));});
app.get('/api/v1/simulator/sessions/:id/economics',getSession,(req,res)=>{const s=req.session;const factor=s.scenario==='economic_sensitivity'?1.25:1;res.json(envelope(s,{tariffId:'TARIFF-SIM-01',currency:'INR',peakRatePerKwh:Number((9.5*factor).toFixed(2)),offPeakRatePerKwh:5.2,avoidedCostPerKwh:Number((7.8*factor).toFixed(2)),integrationCostInr:150000,annualOperatingCostInr:60000,programmeCostInr:210000,assumptionStatus:'SIMULATED_ASSUMPTIONS_ONLY',sourceType:'SIMULATED'}));});
app.use((req,res)=>res.status(404).json({success:false,error:{code:'ROUTE_NOT_FOUND',message:`No route for ${req.method} ${req.path}`}}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({success:false,error:{code:'INTERNAL_ERROR',message:'Unexpected simulator error'}});});
app.listen(PORT,'0.0.0.0',()=>console.log(`ADR simulator listening on ${PORT}`));
