export enum GoalStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  EXPIRED = 'expired'
}

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  [GoalStatus.PENDING]: '待开始',
  [GoalStatus.ACTIVE]: '进行中',
  [GoalStatus.COMPLETED]: '已完成',
  [GoalStatus.EXPIRED]: '已到期'
};

export const GOAL_STATUS_COLORS: Record<GoalStatus, string> = {
  [GoalStatus.PENDING]: 'default',
  [GoalStatus.ACTIVE]: 'processing',
  [GoalStatus.COMPLETED]: 'success',
  [GoalStatus.EXPIRED]: 'error'
};

export enum GoalAdjustmentSegment {
  ORIGINAL = 'original',
  CURRENT = 'current'
}

export const GOAL_ADJUSTMENT_SEGMENT_LABELS: Record<GoalAdjustmentSegment, string> = {
  [GoalAdjustmentSegment.ORIGINAL]: '原上限段结余',
  [GoalAdjustmentSegment.CURRENT]: '新上限段结余'
};

export const GOAL_ADJUSTMENT_ERROR_FIELDS = {
  NEW_VALUE: 'GoalAdjustment.new_value',
  EFFECTIVE_DATE: 'GoalAdjustment.effective_date',
  STATUS: 'Goal.status'
};

