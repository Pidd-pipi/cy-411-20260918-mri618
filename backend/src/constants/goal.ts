export enum GoalStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  EXPIRED = 'expired'
}

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  [GoalStatus.PENDING]: 'Pending',
  [GoalStatus.ACTIVE]: 'Active',
  [GoalStatus.COMPLETED]: 'Completed',
  [GoalStatus.EXPIRED]: 'Expired'
};

export const GOAL_STATUS_ERROR_FIELDS = {
  STATUS: 'Goal.status',
  TARGET_VALUE: 'Goal.target_value'
};

export enum GoalAdjustmentSegment {
  ORIGINAL = 'original',
  CURRENT = 'current'
}

export const GOAL_ADJUSTMENT_ERROR_FIELDS = {
  NEW_VALUE: 'GoalAdjustment.new_value',
  EFFECTIVE_DATE: 'GoalAdjustment.effective_date',
  STATUS: 'Goal.status'
};

