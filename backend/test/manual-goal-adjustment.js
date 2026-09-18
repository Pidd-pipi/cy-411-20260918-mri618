/* eslint-disable no-console */
// Logic-level verification for the mid-term goal adjustment feature.
// Runs against the compiled output (npm run build) so TypeORM decorator
// metadata is available; no MySQL is required (in-memory repository stubs).
//
//   cd backend && npm run build && node test/manual-goal-adjustment.js
const { GoalAdjustmentSegment, GoalStatus } = require('../dist/constants/goal');
const { Goal } = require('../dist/models/goal');
const { GoalAdjustment } = require('../dist/models/goalAdjustment');
const { GoalAdjustmentService } = require('../dist/services/goalAdjustmentService');
const { GoalService } = require('../dist/services/goalService');
const { ActivityService } = require('../dist/services/activityService');

class InMemoryRepo {
  constructor(key) {
    this.key = key;
    this.rows = [];
    this.seq = 1;
  }

  create(data) {
    return { ...data };
  }

  async save(entity) {
    if (!entity.id) entity.id = this.seq++;
    if (this.key === 'goal_adjustments' && !entity.createdAt) entity.createdAt = new Date();
    const idx = this.rows.findIndex((r) => r.id === entity.id);
    if (idx >= 0) this.rows[idx] = entity;
    else this.rows.push(entity);
    return entity;
  }

  async find(options) {
    let result = this.rows.slice();
    if (options?.where) {
      result = result.filter((row) =>
        Object.entries(options.where).every(([k, v]) => String(row[k]) === String(v))
      );
    }
    if (options?.relations?.includes('adjustments')) {
      result = result.map((row) => ({
        ...row,
        adjustments: global.__adjustmentRepo.rows.filter((a) => String(a.goalId) === String(row.id))
      }));
    }
    return result;
  }

  async findOne(options) {
    if (options?.lock) {
      const row = this.rows.find((r) =>
        Object.entries(options.where).every(([k, v]) => String(r[k]) === String(v))
      );
      if (!row) return null;
      return {
        ...row,
        adjustments: global.__adjustmentRepo.rows.filter((a) => String(a.goalId) === String(row.id))
      };
    }
    const rows = await this.find(options);
    return rows[0] ?? null;
  }
}

// ---- Activities ------------------------------------------------------------
const activities = [];
const addActivity = (userId, recordDate, carbonValue) => {
  activities.push({ id: activities.length + 1, userId, carbonValue: String(carbonValue), recordDate, category: 'transport' });
};

const activityRepoStub = {
  find: async (options) => {
    const { userId, recordDate } = options.where;
    let rows = activities.filter((r) => String(r.userId) === String(userId));
    if (recordDate?._type === 'between') {
      const [start, end] = recordDate._value;
      rows = rows.filter((r) => r.recordDate >= start && r.recordDate <= end);
    }
    return rows.map((r) => ({ ...r }));
  }
};
const activityService = new ActivityService(activityRepoStub, {}, {});

// ---- Goals / adjustments ---------------------------------------------------
const goalRepo = new InMemoryRepo('goals');
const adjustmentRepo = new InMemoryRepo('goal_adjustments');
global.__adjustmentRepo = adjustmentRepo; // eslint-disable-line no-underscore-dangle

const seedGoal = async (id, status, cap = 100, start = '2026-09-01', end = '2026-09-30') => {
  await goalRepo.save({
    id,
    userId: 1,
    title: `goal-${id}`,
    targetValue: String(cap),
    periodType: 'month',
    startDate: start,
    endDate: end,
    status
  });
};

// Mirrors uk_goal_adjustment_goal from init.sql inside the transaction.
const manager = {
  findOne: async (entity, options) => {
    if (entity === Goal) return goalRepo.findOne({ ...options, lock: true });
    throw new Error('unexpected entity in manager.findOne');
  },
  find: async (entity, options) => {
    if (entity === Goal) return goalRepo.findOne({ ...options, lock: true });
    throw new Error('unexpected entity in manager.find');
  },
  create: (entity, data) => (entity === GoalAdjustment ? adjustmentRepo.create(data) : goalRepo.create(data)),
  save: async (entityOrTarget, maybeData) => {
    const isTarget = typeof entityOrTarget === 'function';
    const data = isTarget ? maybeData : entityOrTarget;
    if (adjustmentRepo.rows.some((r) => String(r.goalId) === String(data.goalId)) && 'newValue' in data) {
      const err = new Error('Duplicate entry for key uk_goal_adjustment_goal');
      err.code = 'ER_DUP_ENTRY';
      throw err;
    }
    return isTarget && entityOrTarget === Goal ? goalRepo.save(data) : adjustmentRepo.save(data);
  }
};
const dataSource = { transaction: async (cb) => cb(manager) };

const goalService = new GoalService(goalRepo, activityService);
const adjustmentService = new GoalAdjustmentService(goalService, dataSource);

// ---- Assertions ------------------------------------------------------------
let passed = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
};
const expectFail = async (name, fn, code) => {
  try {
    await fn();
    ok(name, false, '(expected rejection)');
  } catch (error) {
    const actual = error.code || error.getResponse?.()?.code;
    ok(name, actual === code, `(code=${actual} expected=${code})`);
  }
};

const run = async () => {
  await seedGoal(1, GoalStatus.ACTIVE, 100);
  addActivity(1, '2026-09-05', 30);
  addActivity(1, '2026-09-10', 20);
  addActivity(1, '2026-09-15', 30);
  await seedGoal(2, GoalStatus.EXPIRED);
  await seedGoal(3, GoalStatus.COMPLETED);

  console.log('\n[1] 已结束 / 非进行中目标拒绝调整');
  await expectFail('expired goal rejected', () => adjustmentService.apply(1, 2, { newValue: 80, effectiveDate: '2026-09-10' }), 'GOAL_STATUS_NOT_ADJUSTABLE');
  await expectFail('completed goal rejected', () => adjustmentService.apply(1, 3, { newValue: 80, effectiveDate: '2026-09-10' }), 'GOAL_STATUS_NOT_ADJUSTABLE');
  ok('no adjustment rows from rejected status', adjustmentRepo.rows.length === 0, `(rows=${adjustmentRepo.rows.length})`);

  console.log('\n[2] 周期外日期拒绝');
  await expectFail('effective date before start rejected', () => adjustmentService.apply(1, 1, { newValue: 80, effectiveDate: '2026-08-31' }), 'GOAL_ADJUSTMENT_DATE_OUT_OF_PERIOD');
  await expectFail('effective date after end rejected', () => adjustmentService.apply(1, 1, { newValue: 80, effectiveDate: '2026-10-01' }), 'GOAL_ADJUSTMENT_DATE_OUT_OF_PERIOD');
  ok('no adjustment rows from rejected dates', adjustmentRepo.rows.length === 0, `(rows=${adjustmentRepo.rows.length})`);

  console.log('\n[3] 非法新上限拒绝');
  await expectFail('new cap zero rejected', () => adjustmentService.apply(1, 1, { newValue: 0, effectiveDate: '2026-09-10' }), 'GOAL_ADJUSTMENT_VALUE_INVALID');
  await expectFail('new cap negative rejected', () => adjustmentService.apply(1, 1, { newValue: -5, effectiveDate: '2026-09-10' }), 'GOAL_ADJUSTMENT_VALUE_INVALID');
  ok('goal still has original cap 100', (await goalService.getOwned(1, 1)).targetValue === '100');

  console.log('\n[4] 合法期中调整落库：原上限负责生效日前，新上限负责当天及以后');
  const result = await adjustmentService.apply(1, 1, { newValue: 60, effectiveDate: '2026-09-10' });
  ok('exactly one adjustment row', adjustmentRepo.rows.length === 1, `(rows=${adjustmentRepo.rows.length})`);
  const row = adjustmentRepo.rows[0];
  ok('snapshot original value = 100', Number(row.originalValue) === 100);
  ok('new value = 60', Number(row.newValue) === 60);
  ok('effective date stored', row.effectiveDate === '2026-09-10');
  const goal = result.goal;
  ok('response originalValue = 100', goal.originalValue === 100);
  ok('response currentCapValue = 60', goal.currentCapValue === 60);
  const origSeg = goal.segments.find((s) => s.segment === GoalAdjustmentSegment.ORIGINAL);
  const curSeg = goal.segments.find((s) => s.segment === GoalAdjustmentSegment.CURRENT);
  ok('original segment covers 09-01..09-09', origSeg.startDate === '2026-09-01' && origSeg.endDate === '2026-09-09', JSON.stringify(origSeg));
  ok('original segment emitted 30 / cap 100 / remaining 70', origSeg.emitted === 30 && origSeg.cap === 100 && origSeg.remaining === 70, JSON.stringify(origSeg));
  ok('current segment covers 09-10..09-30', curSeg.startDate === '2026-09-10' && curSeg.endDate === '2026-09-30', JSON.stringify(curSeg));
  ok('current segment emitted 50 / cap 60 / remaining 10', curSeg.emitted === 50 && curSeg.cap === 60 && curSeg.remaining === 10, JSON.stringify(curSeg));
  ok('total currentValue = 80', goal.currentValue === 80, `(value=${goal.currentValue})`);
  ok('total remaining = 80 (70+10)', goal.remaining === 80, `(remaining=${goal.remaining})`);
  const untouched = await goalService.getOwned(1, 1);
  ok('goal row targetValue untouched (still 100)', untouched.targetValue === '100');

  console.log('\n[5] 再次调整直接拒绝且不留记录、不改进度');
  const progressBefore = JSON.stringify(await goalService.list(1));
  await expectFail('second adjustment rejected', () => adjustmentService.apply(1, 1, { newValue: 40, effectiveDate: '2026-09-20' }), 'GOAL_ADJUSTMENT_DUPLICATE');
  ok('still exactly one adjustment row', adjustmentRepo.rows.length === 1, `(rows=${adjustmentRepo.rows.length})`);
  const progressAfter = JSON.stringify(await goalService.list(1));
  ok('goal progress unchanged after rejected re-adjustment', progressBefore === progressAfter);

  console.log('\n[6] 调整后补录生效日前活动：两段结余都要重算一致');
  addActivity(1, '2026-09-03', 20);
  const refreshed = (await goalService.list(1)).find((g) => g.id === 1);
  const origSeg2 = refreshed.segments.find((s) => s.segment === GoalAdjustmentSegment.ORIGINAL);
  const curSeg2 = refreshed.segments.find((s) => s.segment === GoalAdjustmentSegment.CURRENT);
  ok('original segment recalculated: emitted 50 / remaining 50', origSeg2.emitted === 50 && origSeg2.remaining === 50, JSON.stringify(origSeg2));
  ok('current segment consistent: emitted 50 / remaining 10', curSeg2.emitted === 50 && curSeg2.remaining === 10, JSON.stringify(curSeg2));
  ok('total emitted 100 = 50 + 50', refreshed.currentValue === 100 && origSeg2.emitted + curSeg2.emitted === refreshed.currentValue);
  ok('total remaining 60 = 50 + 10', refreshed.remaining === 60 && refreshed.remaining === origSeg2.remaining + curSeg2.remaining);
  const periodSum = activities
    .filter((a) => a.userId === 1 && a.recordDate >= '2026-09-01' && a.recordDate <= '2026-09-30')
    .reduce((s, a) => s + Number(a.carbonValue), 0);
  ok('segment emissions partition equals full-period sum (no double count)', origSeg2.emitted + curSeg2.emitted === periodSum);

  console.log('\n[7] 生效日等于周期首日：仅新上限段，无原上限段');
  await seedGoal(4, GoalStatus.ACTIVE, 200, '2026-09-01', '2026-09-30');
  addActivity(1, '2026-09-01', 15);
  const res4 = await adjustmentService.apply(1, 4, { newValue: 120, effectiveDate: '2026-09-01' });
  const g4 = res4.goal;
  ok('only one segment (current)', g4.segments.length === 1 && g4.segments[0].segment === GoalAdjustmentSegment.CURRENT, JSON.stringify(g4.segments.map((s) => s.segment)));
  ok('current segment starts at period start', g4.segments[0].startDate === '2026-09-01');
  ok('originalValue snapshot retained = 200', g4.originalValue === 200);
  await expectFail('boundary goal cannot be re-adjusted', () => adjustmentService.apply(1, 4, { newValue: 90, effectiveDate: '2026-09-02' }), 'GOAL_ADJUSTMENT_DUPLICATE');

  console.log('\n[8] 目标不存在');
  await expectFail('unknown goal rejected', () => adjustmentService.apply(1, 999, { newValue: 50, effectiveDate: '2026-09-10' }), 'GOAL_NOT_FOUND');

  console.log(`\n结果: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
