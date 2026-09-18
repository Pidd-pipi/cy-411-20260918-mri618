import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { Repository } from 'typeorm';
import { ErrorCodes } from '../constants/errorCodes';
import { GoalAdjustmentSegment, GoalStatus } from '../constants/goal';
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

export interface GoalSegmentProgress {
  segment: GoalAdjustmentSegment;
  cap: number;
  emitted: number;
  remaining: number;
  progress: number;
  startDate: string;
  endDate: string;
}

const round2 = (value: number) => Number(value.toFixed(2));
const progressOf = (emitted: number, cap: number) => (cap === 0 ? 0 : Math.min(100, Number(((emitted / cap) * 100).toFixed(1))));
const previousDay = (date: string) => dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');

@Injectable()
export class GoalService {
  constructor(
    @InjectRepository(Goal) private readonly goalRepo: Repository<Goal>,
    private readonly activityService: ActivityService
  ) {}

  async list(userId: number) {
    logTemplate('info', 'GOAL_LIST_START');
    const goals = await this.goalRepo.find({
      where: { userId },
      relations: ['adjustments'],
      order: { endDate: 'ASC' }
    });
    return Promise.all(goals.map((goal) => this.attachProgress(userId, goal)));
  }

  async getOwned(userId: number, id: number): Promise<Goal> {
    const goal = await this.goalRepo.findOne({
      where: { userId, id },
      relations: ['adjustments']
    });
    if (!goal) {
      throw new AppError(ErrorCodes.GOAL_NOT_FOUND, `Goal[id=${id}] not found: id not found`, HttpStatus.NOT_FOUND);
    }
    return goal;
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
    const goal = await this.goalRepo.findOne({ where: { userId, id }, relations: ['adjustments'] });
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

  async attachProgress(userId: number, goal: Goal) {
    const adjustment = goal.adjustments?.[0];
    if (!adjustment) {
      const summary = await this.activityService.summarize(userId, goal.startDate, goal.endDate);
      const currentValue = round2(summary.total);
      const targetValue = Number(goal.targetValue);
      const remaining = round2(targetValue - currentValue);
      const progress = progressOf(currentValue, targetValue);
      logTemplate('info', 'GOAL_PROGRESS_CALCULATED', { id: goal.id, currentValue, targetValue });
      return {
        ...this.withoutAdjustments(goal),
        originalValue: null,
        currentCapValue: targetValue,
        currentValue,
        remaining,
        progress,
        segments: null,
        adjustment: null
      };
    }

    const effectiveDate = adjustment.effectiveDate;
    const originalEnd = previousDay(effectiveDate);
    const periodStartsWithOriginalCap = effectiveDate > goal.startDate;
    const segments: GoalSegmentProgress[] = [];

    if (periodStartsWithOriginalCap) {
      const originalSummary = await this.activityService.summarize(userId, goal.startDate, originalEnd);
      const originalEmitted = round2(originalSummary.total);
      const originalCap = Number(adjustment.originalValue);
      segments.push({
        segment: GoalAdjustmentSegment.ORIGINAL,
        cap: originalCap,
        emitted: originalEmitted,
        remaining: round2(originalCap - originalEmitted),
        progress: progressOf(originalEmitted, originalCap),
        startDate: goal.startDate,
        endDate: originalEnd
      });
    }

    const currentSummary = await this.activityService.summarize(userId, effectiveDate, goal.endDate);
    const currentEmitted = round2(currentSummary.total);
    const currentCap = Number(adjustment.newValue);
    segments.push({
      segment: GoalAdjustmentSegment.CURRENT,
      cap: currentCap,
      emitted: currentEmitted,
      remaining: round2(currentCap - currentEmitted),
      progress: progressOf(currentEmitted, currentCap),
      startDate: effectiveDate,
      endDate: goal.endDate
    });

    const activeSegment = segments[segments.length - 1];
    const fullSummary = await this.activityService.summarize(userId, goal.startDate, goal.endDate);
    const currentValue = round2(fullSummary.total);
    const remaining = round2(segments.reduce((sum, segment) => sum + segment.remaining, 0));
    segments.forEach((segment) => {
      logTemplate('info', 'GOAL_ADJUSTMENT_PROGRESS_CALCULATED', {
        goalId: goal.id,
        segment: segment.segment,
        emitted: segment.emitted,
        cap: segment.cap,
        remaining: segment.remaining
      });
    });
    logTemplate('info', 'GOAL_PROGRESS_CALCULATED', { id: goal.id, currentValue, targetValue: activeSegment.cap });
    return {
      ...this.withoutAdjustments(goal),
      originalValue: Number(adjustment.originalValue),
      currentCapValue: activeSegment.cap,
      currentValue,
      remaining,
      progress: activeSegment.progress,
      segments,
      adjustment: {
        id: Number(adjustment.id),
        originalValue: Number(adjustment.originalValue),
        newValue: Number(adjustment.newValue),
        effectiveDate: adjustment.effectiveDate,
        createdAt: adjustment.createdAt
      }
    };
  }

  private withoutAdjustments(goal: Goal) {
    const { adjustments, ...plain } = goal;
    return plain;
  }
}
