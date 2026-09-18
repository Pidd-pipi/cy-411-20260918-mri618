/* eslint-disable no-console */
'use strict';
// HTTP-level check for POST /goals/:id/adjustment: wires the real Nest
// controllers/services with in-memory repositories (no MySQL).
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { INestApplication } = require('@nestjs/common');
const { getRepositoryToken } = require('@nestjs/typeorm');
const request = require('http');

const { GoalStatus, GoalAdjustmentSegment } = require('../dist/constants/goal');
const { Goal } = require('../dist/models/goal');
const { GoalAdjustment } = require('../dist/models/goalAdjustment');
const { User } = require('../dist/models/user');
const { Activity } = require('../dist/models/activity');
const { CarbonFactor } = require('../dist/models/carbonFactor');
const { Role } = require('../dist/models/role');
const { AuditLog } = require('../dist/models/auditLog');
const { GoalController } = require('../dist/controllers/goalController');
const { GoalAdjustmentController } = require('../dist/controllers/goalAdjustmentController');
const { GoalService } = require('../dist/services/goalService');
const { GoalAdjustmentService } = require('../dist/services/goalAdjustmentService');
const { ActivityService } = require('../dist/services/activityService');
const { RequireAuth } = require('../dist/middlewares/auth');
const { ErrorHandler } = require('../dist/middlewares/errorHandler');

const goals = [
  { id: 1, userId: 7, title: 'active goal', targetValue: '100', periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30', status: GoalStatus.ACTIVE, adjustments: [] },
  { id: 2, userId: 7, title: 'expired goal', targetValue: '100', periodType: 'month', startDate: '2026-08-01', endDate: '2026-08-31', status: GoalStatus.EXPIRED, adjustments: [] },
  { id: 3, userId: 7, title: 'untouched active goal', targetValue: '100', periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30', status: GoalStatus.ACTIVE, adjustments: [] }
];
const adjustmentsRows = [];
const acts = [
  { id: 1, userId: 7, carbonValue: '10', recordDate: '2026-09-05', category: 'transport' },
  { id: 2, userId: 7, carbonValue: '20', recordDate: '2026-09-12', category: 'energy' }
];

const goalRepo = {
  find: async (opts) => goals.filter((g) => String(g.userId) === String(opts.where.userId)).map((g) => ({ ...g, adjustments: adjustmentsRows.filter((a) => String(a.goalId) === String(g.id)) })),
  findOne: async (opts) => {
    const locked = !!opts.lock;
    const found = goals.find((g) => String(g.id) === String(opts.where.id) && String(g.userId) === String(opts.where.userId));
    return found ? { ...found, adjustments: adjustmentsRows.filter((a) => String(a.goalId) === String(found.id)) } : null;
  },
  create: (d) => ({ ...d }),
  save: async (g) => g
};
const adjustmentRepo = {
  rows: adjustmentsRows,
  find: async () => adjustmentsRows.slice(),
  findOne: async () => null,
  create: (d) => ({ ...d }),
  save: async (a) => {
    if (adjustmentsRows.some((r) => String(r.goalId) === String(a.goalId))) {
      const err = new Error('dup');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }
    a.id = adjustmentsRows.length + 1;
    a.createdAt = new Date();
    adjustmentsRows.push(a);
    return a;
  }
};
// Real service uses a transaction with manager + pessimistic row lock.
const transactionalManager = {
  findOne: async (entity, opts) => {
    const found = goals.find((g) => String(g.id) === String(opts.where.id) && String(g.userId) === String(opts.where.userId));
    return found ? { ...found, adjustments: adjustmentsRows.filter((a) => String(a.goalId) === String(found.id)) } : null;
  },
  create: (entity, d) => ({ ...d }),
  save: async (entityOrInstance) => adjustmentRepo.save(entityOrInstance)
};
const dataSourceMock = { transaction: async (cb) => cb(transactionalManager) };
const activityRepo = {
  find: async (options) => {
    const { userId, recordDate } = options.where;
    let rows = acts.filter((r) => String(r.userId) === String(userId));
    if (recordDate?._type === 'between') {
      const [s, e] = recordDate._value;
      rows = rows.filter((r) => r.recordDate >= s && r.recordDate <= e);
    }
    return rows;
  }
};

const call = (app, method, path, body) =>
  new Promise((resolve) => {
    const server = app.getHttpServer();
    const payload = body ? JSON.stringify(body) : undefined;
    const req = request.request(
      {
        method,
        path,
        port: server.address().port,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: 'Bearer token' }
          : { authorization: 'Bearer token' }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      }
    );
    if (payload) req.write(payload);
    req.end();
  });

(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [GoalController, GoalAdjustmentController],
    providers: [
      GoalService,
      GoalAdjustmentService,
      ActivityService,
      { provide: require('../dist/services/factorService').FactorService, useValue: {} },
      { provide: require('../dist/services/userService').UserService, useValue: {} },
      { provide: getRepositoryToken(Goal), useValue: goalRepo },
      { provide: getRepositoryToken(GoalAdjustment), useValue: adjustmentRepo },
      { provide: getRepositoryToken(Activity), useValue: activityRepo },
      { provide: getRepositoryToken(User), useValue: {} },
      { provide: getRepositoryToken(Role), useValue: {} },
      { provide: getRepositoryToken(CarbonFactor), useValue: {} },
      { provide: getRepositoryToken(AuditLog), useValue: { write: async () => ({}) } },
      { provide: DataSource, useValue: dataSourceMock }
    ]
  })
    .overrideGuard(RequireAuth)
    .useValue({ canActivate: (ctx) => { ctx.switchToHttp().getRequest().user = { id: 7, roles: ['member'] }; return true; } })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorHandler());
  await app.listen(0);

  let passed = 0;
  const failures = [];
  const check = (name, cond, extra = '') => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
  };

  console.log('[HTTP-1] 合法调整 201/200 + 响应体');
  const r1 = await call(app, 'POST', '/goals/1/adjustment', { newValue: 60, effectiveDate: '2026-09-10' });
  check('status 201', r1.status === 201, `got ${r1.status}`);
  check('message present', /adjustment/i.test(r1.body?.message || ''), JSON.stringify(r1.body));
  check('originalValue 100', r1.body?.goal?.originalValue === 100, JSON.stringify(r1.body?.goal));
  check('currentCapValue 60', r1.body?.goal?.currentCapValue === 60);
  const segNames = (r1.body?.goal?.segments || []).map((s) => s.segment);
  check('segments original+current', segNames.join(',') === `${GoalAdjustmentSegment.ORIGINAL},${GoalAdjustmentSegment.CURRENT}`, segNames.join(','));

  console.log('[HTTP-2] 再次调整 409');
  const r2 = await call(app, 'POST', '/goals/1/adjustment', { newValue: 40, effectiveDate: '2026-09-11' });
  check('status 409', r2.status === 409, `got ${r2.status}`);
  check('code duplicate', r2.body?.code === 'GOAL_ADJUSTMENT_DUPLICATE', JSON.stringify(r2.body));
  check('still one row', adjustmentsRows.length === 1);

  console.log('[HTTP-3] 已结束目标 409');
  const r3 = await call(app, 'POST', '/goals/2/adjustment', { newValue: 50, effectiveDate: '2026-08-10' });
  check('status 409', r3.status === 409, `got ${r3.status}`);
  check('code not adjustable', r3.body?.code === 'GOAL_STATUS_NOT_ADJUSTABLE', JSON.stringify(r3.body));

  console.log('[HTTP-4] 周期外日期 400');
  const r4 = await call(app, 'POST', '/goals/3/adjustment', { newValue: 50, effectiveDate: '2025-01-01' });
  check('status 400', r4.status === 400, `got ${r4.status}`);
  check('code out of period', r4.body?.code === 'GOAL_ADJUSTMENT_DATE_OUT_OF_PERIOD', JSON.stringify(r4.body));
  check('rejected goal 3 has no adjustment row', !adjustmentsRows.some((a) => String(a.goalId) === '3'));

  console.log('[HTTP-5] 不存在目标 404');
  const r5 = await call(app, 'POST', '/goals/999/adjustment', { newValue: 50, effectiveDate: '2026-09-10' });
  check('status 404', r5.status === 404, `got ${r5.status}`);
  check('code not found', r5.body?.code === 'GOAL_NOT_FOUND', JSON.stringify(r5.body));

  console.log('[HTTP-6] GET /goals 仍可用并携带分段结余');
  const r6 = await call(app, 'GET', '/goals');
  check('status 200', r6.status === 200, `got ${r6.status}`);
  const g1 = r6.body.find((g) => g.id === 1);
  check('adjusted goal has segments', Array.isArray(g1?.segments) && g1.segments.length === 2, JSON.stringify(g1?.segments));
  check('segments remaining 90 / 40', g1.segments[0].remaining === 90 && g1.segments[1].remaining === 40, JSON.stringify(g1.segments));
  const g2 = r6.body.find((g) => g.id === 2);
  check('unadjusted goal keeps plain remaining', g2?.segments === null && typeof g2?.remaining === 'number', JSON.stringify(g2));

  await app.close();
  console.log(`\nHTTP 结果: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
