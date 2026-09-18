import { HttpStatus, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { DataSource } from 'typeorm';
import { ErrorCodes } from '../constants/errorCodes';
import { GoalStatus, GOAL_ADJUSTMENT_ERROR_FIELDS } from '../constants/goal';
import { Messages } from '../constants/messages';
import { Goal } from '../models/goal';
import { GoalAdjustment } from '../models/goalAdjustment';
import { AppError } from '../utils/AppError';
import { logTemplate } from '../utils/logger';
import { GoalService } from './goalService';

export interface GoalAdjustmentInput {
  newValue: number;
  effectiveDate: string;
}

@Injectable()
export class GoalAdjustmentService {
  constructor(
    private readonly goalService: GoalService,
    private readonly dataSource: DataSource
  ) {}

  async apply(userId: number, goalId: number, input: GoalAdjustmentInput) {
    const effectiveDate = dayjs(input.effectiveDate).format('YYYY-MM-DD');
    const newValue = Number(input.newValue);
    logTemplate('info', 'GOAL_ADJUSTMENT_START', { id: goalId, effectiveDate, newValue });

    if (!Number.isFinite(newValue) || newValue <= 0) {
      logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', {
        goalId,
        field: GOAL_ADJUSTMENT_ERROR_FIELDS.NEW_VALUE,
        reason: 'must be greater than zero'
      });
      throw new AppError(
        ErrorCodes.GOAL_ADJUSTMENT_VALUE_INVALID,
        `GoalAdjustment[goal_id=${goalId}] apply failed: ${GOAL_ADJUSTMENT_ERROR_FIELDS.NEW_VALUE} must be greater than zero`,
        HttpStatus.BAD_REQUEST
      );
    }
    if (!input.effectiveDate || !dayjs(input.effectiveDate).isValid()) {
      logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', {
        goalId,
        field: GOAL_ADJUSTMENT_ERROR_FIELDS.EFFECTIVE_DATE,
        reason: 'invalid date'
      });
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        `GoalAdjustment[goal_id=${goalId}] apply failed: ${GOAL_ADJUSTMENT_ERROR_FIELDS.EFFECTIVE_DATE} invalid date`,
        HttpStatus.BAD_REQUEST
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const lockedGoal = await manager.findOne(Goal, {
        where: { id: goalId, userId },
        relations: ['adjustments'],
        lock: { mode: 'pessimistic_write' }
      });
      if (!lockedGoal) {
        logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', { goalId, field: 'Goal.id', reason: 'not found' });
        throw new AppError(ErrorCodes.GOAL_NOT_FOUND, `Goal[id=${goalId}] adjustment failed: id not found`, HttpStatus.NOT_FOUND);
      }

      if (lockedGoal.status !== GoalStatus.ACTIVE) {
        logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', {
          goalId,
          field: GOAL_ADJUSTMENT_ERROR_FIELDS.STATUS,
          reason: `status=${lockedGoal.status} is not active`
        });
        throw new AppError(
          ErrorCodes.GOAL_STATUS_NOT_ADJUSTABLE,
          `GoalAdjustment[goal_id=${goalId}] apply failed: ${GOAL_ADJUSTMENT_ERROR_FIELDS.STATUS} ${lockedGoal.status} goal cannot be adjusted`,
          HttpStatus.CONFLICT
        );
      }

      if (lockedGoal.adjustments.length > 0) {
        logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', { goalId, field: 'GoalAdjustment.id', reason: 'adjustment already exists' });
        throw new AppError(
          ErrorCodes.GOAL_ADJUSTMENT_DUPLICATE,
          `GoalAdjustment[goal_id=${goalId}] apply failed: goal already has a mid-term adjustment`,
          HttpStatus.CONFLICT
        );
      }

      if (effectiveDate < lockedGoal.startDate || effectiveDate > lockedGoal.endDate) {
        logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', {
          goalId,
          field: GOAL_ADJUSTMENT_ERROR_FIELDS.EFFECTIVE_DATE,
          reason: `out of period ${lockedGoal.startDate}..${lockedGoal.endDate}`
        });
        throw new AppError(
          ErrorCodes.GOAL_ADJUSTMENT_DATE_OUT_OF_PERIOD,
          `GoalAdjustment[goal_id=${goalId}] apply failed: ${GOAL_ADJUSTMENT_ERROR_FIELDS.EFFECTIVE_DATE} ${effectiveDate} outside goal period ${lockedGoal.startDate}..${lockedGoal.endDate}`,
          HttpStatus.BAD_REQUEST
        );
      }

      let saved: GoalAdjustment;
      try {
        const adjustment = manager.create(GoalAdjustment, {
          goalId,
          userId,
          originalValue: lockedGoal.targetValue,
          newValue: String(newValue),
          effectiveDate
        });
        saved = await manager.save(adjustment);
        logTemplate('info', 'GOAL_ADJUSTMENT_SUCCESS', {
          id: saved.id,
          goalId,
          originalValue: saved.originalValue,
          newValue: saved.newValue,
          effectiveDate: saved.effectiveDate
        });
      } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
          logTemplate('warn', 'GOAL_ADJUSTMENT_FAILED', { goalId, field: 'GoalAdjustment.goal_id', reason: error.message });
          throw new AppError(
            ErrorCodes.GOAL_ADJUSTMENT_DUPLICATE,
            `GoalAdjustment[goal_id=${goalId}] apply failed: goal already has a mid-term adjustment`,
            HttpStatus.CONFLICT
          );
        }
        throw error;
      }

      const goalWithAdjustment: Goal = { ...lockedGoal, adjustments: [saved] };
      const goal = await this.goalService.attachProgress(userId, goalWithAdjustment);
      return { message: Messages.GOAL_ADJUSTED, goal };
    });
  }
}
