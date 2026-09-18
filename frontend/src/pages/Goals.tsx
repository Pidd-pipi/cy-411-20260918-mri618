import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { GoalProgressCard } from '../components/common/GoalProgressCard';
import { EmptyState } from '../components/common/EmptyState';
import { GoalStatus, GOAL_STATUS_LABELS } from '../constants/goal';
import { useGoalStore } from '../stores/goalStore';
import { useAuth } from '../hooks/useAuth';
import { Messages } from '../constants/messages';
import { Goal } from '../types/entities';

export function Goals() {
  const [open, setOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Goal | null>(null);
  const goals = useGoalStore((state) => state.goals);
  const load = useGoalStore((state) => state.load);
  const add = useGoalStore((state) => state.add);
  const adjust = useGoalStore((state) => state.adjust);
  const { token } = useAuth();

  useEffect(() => {
    if (!token) return;
    void load();
  }, [load, token]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <Typography.Title level={2}>目标管理</Typography.Title>
          <Typography.Text type="secondary">减排目标会直接联动活动汇总，进行中的目标可提交一次期中调整。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建目标</Button>
      </Space>
      <div className="card-grid">
        {goals.length ? goals.map((goal) => <GoalProgressCard key={goal.id} goal={goal} onAdjust={setAdjustTarget} />) : <EmptyState text="暂无减排目标" />}
      </div>
      <Modal title="创建目标" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnClose>
        <Form
          layout="vertical"
          initialValues={{ status: GoalStatus.ACTIVE, periodType: 'month', startDate: dayjs().startOf('month'), endDate: dayjs().endOf('month') }}
          onFinish={async (values) => {
            await add({ ...values, startDate: values.startDate.format('YYYY-MM-DD'), endDate: values.endDate.format('YYYY-MM-DD') });
            message.success(Messages.FRONTEND_GOAL_SAVED);
            setOpen(false);
          }}
        >
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="targetValue" label="目标排放上限 kg CO2e" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="periodType" label="周期" rules={[{ required: true }]}><Select options={[{ value: 'week', label: '周' }, { value: 'month', label: '月' }, { value: 'quarter', label: '季度' }]} /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={Object.values(GoalStatus).map((value) => ({ value, label: GOAL_STATUS_LABELS[value] }))} /></Form.Item>
          <Form.Item name="startDate" label="开始日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="endDate" label="结束日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Button type="primary" htmlType="submit" block>保存目标</Button>
        </Form>
      </Modal>
      <Modal
        title={Messages.FRONTEND_GOAL_ADJUST_TITLE}
        open={!!adjustTarget}
        onCancel={() => setAdjustTarget(null)}
        footer={null}
        destroyOnClose
      >
        {adjustTarget ? (
          <Form
            layout="vertical"
            initialValues={{
              newTargetValue: Number(adjustTarget.originalTargetValue ?? adjustTarget.targetValue),
              effectiveDate: dayjs() as Dayjs
            }}
            onFinish={async (values) => {
              await adjust(adjustTarget.id, {
                newTargetValue: Number(values.newTargetValue),
                effectiveDate: values.effectiveDate.format('YYYY-MM-DD')
              });
              message.success(Messages.FRONTEND_GOAL_ADJUSTED);
              setAdjustTarget(null);
            }}
          >
            <Typography.Paragraph type="secondary">
              {adjustTarget.title}（{formatRange(adjustTarget)}）：原上限 {Number(adjustTarget.originalTargetValue ?? adjustTarget.targetValue)} kg CO2e，
              生效日前沿用原上限，生效日当天起使用新上限；每个目标仅能调整一次。
            </Typography.Paragraph>
            <Form.Item
              name="newTargetValue"
              label="新排放上限 kg CO2e"
              rules={[{ required: true, message: '请输入新上限' }]}
            >
              <InputNumber min={1} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="effectiveDate"
              label="生效日期（需在目标周期内）"
              rules={[{ required: true, message: '请选择生效日期' }]}
            >
              <DatePicker
                style={{ width: '100%' }}
                disabledDate={(current) => Boolean(current && (current.isBefore(adjustTarget.startDate, 'day') || current.isAfter(adjustTarget.endDate, 'day')))}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>提交调整</Button>
          </Form>
        ) : null}
      </Modal>
    </Space>
  );
}

function formatRange(goal: Goal) {
  return `${goal.startDate} - ${goal.endDate}`;
}
