import { Body, Controller, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ErrorCodes } from '../constants/errorCodes';
import { RequireAuth } from '../middlewares/auth';
import { GoalAdjustmentInput, GoalAdjustmentService } from '../services/goalAdjustmentService';
import { AppError } from '../utils/AppError';
import { logTemplate } from '../utils/logger';

@Controller('goals/:id/adjustment')
@UseGuards(RequireAuth)
export class GoalAdjustmentController {
  constructor(private readonly goalAdjustmentService: GoalAdjustmentService) {}

  @Post()
  async apply(@Req() request: Request, @Param('id') id: string, @Body() body: GoalAdjustmentInput) {
    request.auditEntity = 'GoalAdjustment';
    request.auditEntityId = Number(id);
    request.auditAction = 'Goal adjustment apply';
    try {
      return await this.goalAdjustmentService.apply(request.user!.id, Number(id), body);
    } catch (error: any) {
      logTemplate('error', 'GOAL_ADJUSTMENT_FAILED', { goalId: id, field: 'GoalAdjustment.controller', reason: error.message });
      throw new AppError(
        error.code || ErrorCodes.DATABASE_FAILED,
        `GoalAdjustment[goal_id=${id}] controller apply failed: ${error.message}`,
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }
}
