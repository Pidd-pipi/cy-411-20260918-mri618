import { Button, Card, Progress, Space, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { GoalStatus, GOAL_STATUS_COLORS, GOAL_ADJUSTMENT_SEGMENT_LABELS, GoalAdjustmentSegment } from '../../constants/goal';
import { Goal } from '../../types/entities';
import { formatCarbon, formatDate, formatGoalStatus } from '../../utils/formatters';

interface GoalProgressCardProps {
  goal: Goal;
  onAdjust?: (goal: Goal) => void;
}

export function GoalProgressCard({ goal, onAdjust }: GoalProgressCardProps) {
  const progress = Number(goal.progress || 0);
  const segments = goal.segments ?? [];
  const currentCap = Number(goal.currentCapValue ?? goal.targetValue);
  return (
    <Card className="goal-card" size="small">
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Typography.Text strong>{goal.title}</Typography.Text>
            <div className="muted">{formatDate(goal.startDate)} - {formatDate(goal.endDate)}</div>
          </div>
          <Tag color={GOAL_STATUS_COLORS[goal.status || GoalStatus.ACTIVE]}>{formatGoalStatus(goal.status)}</Tag>
        </Space>
        <Progress percent={progress} strokeColor={progress > 90 ? '#c84f31' : '#2f7d59'} />
        <div className="split-line">
          <span>已排放 {formatCarbon(goal.currentValue || 0)}</span>
          <span>当前上限 {formatCarbon(currentCap)}</span>
        </div>
        {goal.adjustment && goal.originalValue !== null && goal.originalValue !== undefined ? (
          <div className="split-line">
            <span>原上限 {formatCarbon(goal.originalValue)}</span>
            <span>
              自 {formatDate(goal.adjustment.effectiveDate)} 起调整为 {formatCarbon(currentCap)}
            </span>
          </div>
        ) : null}
        {segments.length ? (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {segments.map((segment) => (
              <div className="split-line" key={segment.segment}>
                <span>
                  {GOAL_ADJUSTMENT_SEGMENT_LABELS[segment.segment as GoalAdjustmentSegment] ?? segment.segment}
                  （{formatDate(segment.startDate)} - {formatDate(segment.endDate)}）
                </span>
                <span style={{ color: segment.remaining < 0 ? '#c84f31' : '#2f7d59' }}>
                  {formatCarbon(segment.remaining)}
                </span>
              </div>
            ))}
          </Space>
        ) : (
          <div className="split-line">
            <span>剩余额</span>
            <span style={{ color: Number(goal.remaining || 0) < 0 ? '#c84f31' : '#2f7d59' }}>
              {formatCarbon(goal.remaining ?? Number(goal.targetValue) - Number(goal.currentValue || 0))}
            </span>
          </div>
        )}
        {onAdjust ? (
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={goal.status !== GoalStatus.ACTIVE || Boolean(goal.adjustment)}
            onClick={() => onAdjust(goal)}
          >
            {goal.adjustment ? '已期中调整' : '期中调整'}
          </Button>
        ) : null}
      </Space>
    </Card>
  );
}
