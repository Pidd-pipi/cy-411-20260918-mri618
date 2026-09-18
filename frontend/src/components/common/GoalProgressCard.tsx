import { Button, Card, Progress, Space, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { GoalStatus, GOAL_STATUS_COLORS } from '../../constants/goal';
import { Messages } from '../../constants/messages';
import { Goal } from '../../types/entities';
import { formatCarbon, formatDate, formatGoalStatus } from '../../utils/formatters';

interface GoalProgressCardProps {
  goal: Goal;
  onAdjust?: (goal: Goal) => void;
}

export function GoalProgressCard({ goal, onAdjust }: GoalProgressCardProps) {
  const progress = Number(goal.progress || 0);
  const originalCap = goal.originalTargetValue ?? Number(goal.targetValue);
  const currentCap = goal.currentTargetValue ?? Number(goal.targetValue);
  const remaining = goal.remainingValue ?? (Number(goal.targetValue) - Number(goal.currentValue || 0));
  const remainingColor = remaining < 0 ? '#c84f31' : '#2f7d59';

  return (
    <Card className="goal-card" size="small">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Typography.Text strong>{goal.title}</Typography.Text>
            <div className="muted">{formatDate(goal.startDate)} - {formatDate(goal.endDate)}</div>
          </div>
          <Space size={4}>
            {goal.adjustment ? <Tag color="gold">{Messages.FRONTEND_GOAL_ADJUST_BUTTON}</Tag> : null}
            <Tag color={GOAL_STATUS_COLORS[goal.status || GoalStatus.ACTIVE]}>{formatGoalStatus(goal.status)}</Tag>
          </Space>
        </Space>
        <Progress percent={progress} strokeColor={progress > 90 ? '#c84f31' : '#2f7d59'} />
        <div className="split-line">
          <span>已排放 {formatCarbon(goal.currentValue || 0)}</span>
          <span>{Messages.FRONTEND_GOAL_CAP_CURRENT} {formatCarbon(currentCap)}</span>
        </div>
        <div className="split-line">
          <span>{Messages.FRONTEND_GOAL_CAP_ORIGINAL} {formatCarbon(originalCap)}</span>
          <span style={{ color: remainingColor }}>{Messages.FRONTEND_GOAL_REMAINING} {formatCarbon(remaining)}</span>
        </div>
        {goal.adjustment ? (
          <div className="goal-segments">
            {(goal.segments || []).map((segment) => (
              <div className="split-line" key={segment.phase}>
                <span>{segment.phase === 'original' ? Messages.FRONTEND_GOAL_CAP_ORIGINAL : Messages.FRONTEND_GOAL_CAP_CURRENT}段 {formatDate(segment.startDate)} - {formatDate(segment.endDate)}</span>
                <span style={{ color: segment.remainingValue < 0 ? '#c84f31' : '#2f7d59' }}>
                  结余 {formatCarbon(segment.remainingValue)}
                </span>
              </div>
            ))}
            <div className="muted">新上限 {formatCarbon(Number(goal.adjustment.newTargetValue))} 自 {formatDate(goal.adjustment.effectiveDate)} 起生效</div>
          </div>
        ) : null}
        {onAdjust && goal.status === GoalStatus.ACTIVE ? (
          <Button size="small" icon={<EditOutlined />} onClick={() => onAdjust(goal)} block>
            {Messages.FRONTEND_GOAL_ADJUST_BUTTON}
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
