import { GoalController } from '../controllers/goalController';
import { GoalAdjustmentController } from '../controllers/goalAdjustmentController';
import { GoalStatus } from '../constants/goal';
import { logTemplate } from '../utils/logger';

export const goalRoutes = [
  'GET /goals requireAuth',
  'POST /goals requireAuth audit',
  'PATCH /goals/:id requireAuth audit',
  'POST /goals/:id/adjustment requireAuth audit'
];

logTemplate('info', 'GOAL_LIST_START', { values: Object.values(GoalStatus).join(',') });
export const goalRouteControllers = [GoalController, GoalAdjustmentController];
