import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { DataSource, Repository } from 'typeorm';
import { ErrorCodes } from '../constants/errorCodes';
import { GoalStatus } from '../constants/goal';
import { Messages } from '../constants/messages';
import { Goal } from '../models/goal';
import { GoalAdjustment } from '../models/goalAdjustment';
import { AppError } from '../utils/AppError';
import { logTemplate } from '../utils/logger';
import { ActivityService } from './activityService';

export interface GoalInput {
  title: string;
  targetValue: number;
  periodType: string;
  startDate: string;
  endDate: string;
  status: GoalStatus;
}

export interface GoalAdjustmentInput {
  newTargetValue: number;
  effectiveDate: string;
}

export interface GoalSegment {
  phase: 'original' | 'adjusted';
  startDate: string;
  endDate: string;
  targetValue: number;
  currentValue: number;
  remainingValue: number;
}

@Injectable()
export class GoalService {
  constructor(
    @InjectRepository(Goal) private readonly goalRepo: Repository<Goal>,
    @InjectRepository(GoalAdjustment) private readonly adjustmentRepo: Repository<GoalAdjustment>,
    private readonly activityService: ActivityService,
    private readonly dataSource: DataSource
  ) {}

  async list(userId: number) {
    logTemplate('info', 'GOAL_LIST_START');
    const goals = await this.goalRepo.find({ where: { userId }, order: { endDate: 'ASC' } });
    return Promise.all(goals.map((goal) => this.attachProgress(userId, goal)));
  }

  async create(userId: number, input: GoalInput) {
    logTemplate('info', 'GOAL_CREATE_START', { userId, status: input.status });
    if (!Object.values(GoalStatus).includes(input.status)) {
      logTemplate('warn', 'GOAL_CREATE_FAILED', { id: 0, field: 'Goal.status', reason: 'invalid enum' });
      throw new AppError(ErrorCodes.GOAL_STATUS_INVALID, `Goal[id=0] create failed: status invalid`);
    }
    const goal = this.goalRepo.create({
      userId,
      title: input.title,
      targetValue: String(input.targetValue),
      periodType: input.periodType,
      startDate: dayjs(input.startDate).format('YYYY-MM-DD'),
      endDate: dayjs(input.endDate).format('YYYY-MM-DD'),
      status: input.status
    });
    const saved = await this.goalRepo.save(goal);
    logTemplate('info', 'GOAL_CREATE_SUCCESS', { id: saved.id, targetValue: saved.targetValue });
    return { message: Messages.GOAL_CREATED, goal: await this.attachProgress(userId, saved) };
  }

  async update(userId: number, id: number, input: Partial<GoalInput>) {
    const goal = await this.goalRepo.findOne({ where: { userId, id } });
    if (!goal) {
      throw new AppError(ErrorCodes.GOAL_NOT_FOUND, `Goal[id=${id}] update failed: id not found`, HttpStatus.NOT_FOUND);
    }
    goal.title = input.title ?? goal.title;
    goal.targetValue = input.targetValue ? String(input.targetValue) : goal.targetValue;
    goal.periodType = input.periodType ?? goal.periodType;
    goal.startDate = input.startDate ? dayjs(input.startDate).format('YYYY-MM-DD') : goal.startDate;
    goal.endDate = input.endDate ? dayjs(input.endDate).format('YYYY-MM-DD') : goal.endDate;
    goal.status = input.status ?? goal.status;
    if (!Object.values(GoalStatus).includes(goal.status)) {
      throw new AppError(ErrorCodes.GOAL_STATUS_INVALID, `Goal[id=${id}] update failed: status invalid`);
    }
    const saved = await this.goalRepo.save(goal);
    return { message: Messages.GOAL_UPDATED, goal: await this.attachProgress(userId, saved) };
  }

  async adjust(userId: number, id: number, input: GoalAdjustmentInput) {
    const newTargetValue = Number(input.newTargetValue);
    if (!Number.isFinite(newTargetValue) || newTargetValue <= 0) {
      logTemplate('warn', 'GOAL_ADJUST_FAILED', { id, field: 'GoalAdjustment.new_target_value', reason: 'must be positive' });
      throw new AppError(
        ErrorCodes.GOAL_ADJUST_TARGET_INVALID,
        `Goal[id=${id}] adjustment failed: newTargetValue must be a positive number`
      );
    }
    const effectiveDate = dayjs(input.effectiveDate);
    if (!input.effectiveDate || !effectiveDate.isValid()) {
      logTemplate('warn', 'GOAL_ADJUST_FAILED', { id, field: 'GoalAdjustment.effective_date', reason: 'invalid date' });
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        `Goal[id=${id}] adjustment failed: effectiveDate invalid`
      );
    }
    const effective = effectiveDate.format('YYYY-MM-DD');
    logTemplate('info', 'GOAL_ADJUST_START', { id, effectiveDate: effective, newTargetValue });

    // 整段调整放在一个事务里：校验与落库同生共死，失败方不会留下任何记录，也不会改动目标。
    // 对 goals 行加悲观锁，并配合 goal_adjustments(goal_id) 唯一索引，保证两项并发调整只有一项落库。
    let adjustmentId = 0;
    try {
      await this.dataSource.transaction(async (manager) => {
        const goal = await manager.findOne(Goal, {
          where: { id, userId },
          lock: { mode: 'pessimistic_write' }
        });
        if (!goal) {
          throw new AppError(ErrorCodes.GOAL_NOT_FOUND, `Goal[id=${id}] adjustment failed: id not found`, HttpStatus.NOT_FOUND);
        }
        // 已结束目标（completed/expired）以及非进行中目标一律拒绝。
        if (goal.status !== GoalStatus.ACTIVE) {
          logTemplate('warn', 'GOAL_ADJUST_FAILED', { id, field: 'Goal.status', reason: `status=${goal.status}` });
          throw new AppError(
            ErrorCodes.GOAL_ADJUST_NOT_ACTIVE,
            `Goal[id=${id}] adjustment failed: only active goals accept mid-term adjustments, current status ${goal.status}`,
            HttpStatus.CONFLICT
          );
        }
        // 生效日期必须落在目标周期内（周期外日期拒绝）。
        if (effective < goal.startDate || effective > goal.endDate) {
          logTemplate('warn', 'GOAL_ADJUST_FAILED', { id, field: 'GoalAdjustment.effective_date', reason: `out of ${goal.startDate}~${goal.endDate}` });
          throw new AppError(
            ErrorCodes.GOAL_ADJUST_DATE_OUT_OF_PERIOD,
            `Goal[id=${id}] adjustment failed: effectiveDate ${effective} out of period ${goal.startDate}~${goal.endDate}`,
            HttpStatus.BAD_REQUEST
          );
        }
        // 同一目标只允许一次期中调整（再次调整拒绝）。
        const existing = await manager.findOne(GoalAdjustment, { where: { goalId: id } });
        if (existing) {
          logTemplate('warn', 'GOAL_ADJUST_FAILED', { id, field: 'GoalAdjustment.goal_id', reason: `already adjusted id=${existing.id}` });
          throw new AppError(
            ErrorCodes.GOAL_ADJUST_DUPLICATE,
            `Goal[id=${id}] adjustment failed: adjustment[id=${existing.id}] already exists, only one mid-term adjustment is allowed`,
            HttpStatus.CONFLICT
          );
        }
        const adjustment = manager.create(GoalAdjustment, {
          goalId: id,
          userId,
          originalTargetValue: goal.targetValue,
          newTargetValue: String(newTargetValue),
          effectiveDate: effective
        });
        const saved = await manager.save(adjustment);
        adjustmentId = Number(saved.id);
        // 注意：goal 本身（target_value/status/进度）在此事务中不做任何修改。
      });
    } catch (error: any) {
      // 唯一索引兜底并发竞态：另一项调整已抢先落库时，本次事务整体回滚。
      if (error?.code === 'ER_DUP_ENTRY') {
        logTemplate('warn', 'GOAL_ADJUST_FAILED', { id, field: 'GoalAdjustment.goal_id', reason: 'duplicate entry under race' });
        throw new AppError(
          ErrorCodes.GOAL_ADJUST_CONFLICT,
          `Goal[id=${id}] adjustment failed: a concurrent adjustment was stored first, only one adjustment is allowed`,
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }

    const adjustment = await this.adjustmentRepo.findOne({ where: { id: adjustmentId } });
    const goal = await this.goalRepo.findOne({ where: { userId, id } });
    logTemplate('info', 'GOAL_ADJUST_SUCCESS', {
      id,
      adjustmentId,
      originalTargetValue: adjustment?.originalTargetValue,
      newTargetValue,
      effectiveDate: effective
    });
    return { message: Messages.GOAL_ADJUSTED, adjustment, goal: await this.attachProgress(userId, goal!) };
  }

  private async attachProgress(userId: number, goal: Goal) {
    const adjustment = await this.adjustmentRepo.findOne({ where: { goalId: goal.id } });
    const segments: GoalSegment[] = [];

    if (!adjustment) {
      const summary = await this.activityService.summarize(userId, goal.startDate, goal.endDate);
      const currentValue = summary.total;
      const targetValue = Number(goal.targetValue);
      const progress = targetValue === 0 ? 0 : Math.min(100, Number(((currentValue / targetValue) * 100).toFixed(1)));
      logTemplate('info', 'GOAL_PROGRESS_CALCULATED', { id: goal.id, currentValue, targetValue });
      return { ...goal, currentValue, progress, originalTargetValue: targetValue, currentTargetValue: targetValue, remainingValue: Number((targetValue - currentValue).toFixed(2)), segments };
    }

    const originalCap = Number(adjustment.originalTargetValue);
    const newCap = Number(adjustment.newTargetValue);
    const segmentStartBoundary = goal.startDate;
    const segmentSplit = dayjs(adjustment.effectiveDate).subtract(1, 'day').format('YYYY-MM-DD');
    const adjustedStart = adjustment.effectiveDate;
    const periodEnd = goal.endDate;

    // 原上限负责生效日前；生效日恰好是周期首日时原段为空，不参与汇总。
    if (segmentStartBoundary <= segmentSplit) {
      const summary = await this.activityService.summarize(userId, segmentStartBoundary, segmentSplit);
      segments.push({
        phase: 'original',
        startDate: segmentStartBoundary,
        endDate: segmentSplit,
        targetValue: originalCap,
        currentValue: summary.total,
        remainingValue: Number((originalCap - summary.total).toFixed(2))
      });
    }
    // 新上限负责生效日当天及以后。
    if (adjustedStart <= periodEnd) {
      const summary = await this.activityService.summarize(userId, adjustedStart, periodEnd);
      segments.push({
        phase: 'adjusted',
        startDate: adjustedStart,
        endDate: periodEnd,
        targetValue: newCap,
        currentValue: summary.total,
        remainingValue: Number((newCap - summary.total).toFixed(2))
      });
    }

    const originalSegment = segments.find((segment) => segment.phase === 'original');
    const adjustedSegment = segments.find((segment) => segment.phase === 'adjusted');
    const currentValue = Number(segments.reduce((sum, segment) => sum + segment.currentValue, 0).toFixed(2));
    const totalTarget = segments.reduce((sum, segment) => sum + segment.targetValue, 0);
    const remainingValue = Number(segments.reduce((sum, segment) => sum + segment.remainingValue, 0).toFixed(2));
    const progress = totalTarget === 0 ? 0 : Math.min(100, Number(((currentValue / totalTarget) * 100).toFixed(1)));

    // 目标卡“当前上限”：今天早于生效日展示原上限，生效日当天及以后展示新上限。
    const today = dayjs().format('YYYY-MM-DD');
    const currentTargetValue = today < adjustedStart ? originalCap : newCap;

    logTemplate('info', 'GOAL_PROGRESS_CALCULATED', { id: goal.id, currentValue, targetValue: totalTarget });
    logTemplate('info', 'GOAL_ADJUST_SEGMENTS_CALCULATED', {
      id: goal.id,
      originalRemaining: originalSegment?.remainingValue ?? 0,
      newRemaining: adjustedSegment?.remainingValue ?? 0
    });
    return {
      ...goal,
      currentValue,
      progress,
      originalTargetValue: originalCap,
      currentTargetValue,
      remainingValue,
      adjustment,
      segments
    };
  }
}
