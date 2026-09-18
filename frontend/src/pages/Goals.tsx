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
import { GoalAdjustmentPayload } from '../api/goal';
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

  const submitAdjustment = async (values: { newValue: number; effectiveDate: Dayjs }) => {
    if (!adjustTarget) return;
    const payload: GoalAdjustmentPayload = {
      newValue: values.newValue,
      effectiveDate: values.effectiveDate.format('YYYY-MM-DD')
    };
    await adjust(adjustTarget.id, payload);
    message.success(Messages.FRONTEND_GOAL_ADJUSTED);
    setAdjustTarget(null);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <Typography.Title level={2}>目标管理</Typography.Title>
          <Typography.Text type="secondary">期中调整后，原上限负责生效日前，新上限负责生效日及以后。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建目标</Button>
      </Space>
      <div className="card-grid">
        {goals.length ? (
          goals.map((goal) => <GoalProgressCard key={goal.id} goal={goal} onAdjust={setAdjustTarget} />)
        ) : (
          <EmptyState text="暂无减排目标" />
        )}
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
        title={adjustTarget ? `期中调整：${adjustTarget.title}` : '期中调整'}
        open={Boolean(adjustTarget)}
        onCancel={() => setAdjustTarget(null)}
        footer={null}
        destroyOnClose
      >
        {adjustTarget ? (
          <Form
            layout="vertical"
            initialValues={{
              newValue: Number(adjustTarget.targetValue),
              effectiveDate: dayjs().isAfter(dayjs(adjustTarget.startDate)) ? dayjs() : dayjs(adjustTarget.startDate)
            }}
            onFinish={submitAdjustment}
          >
            <Typography.Paragraph type="secondary">
              原上限 {Number(adjustTarget.targetValue).toFixed(2)} kg CO2e 负责生效日之前的排放；新上限负责生效日当天及以后。每个进行中的目标只能调整一次。
            </Typography.Paragraph>
            <Form.Item
              name="newValue"
              label="新排放上限 kg CO2e"
              rules={[{ required: true, message: '请输入新的排放上限' }]}
            >
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="effectiveDate"
              label="生效日期"
              rules={[
                { required: true, message: '请选择生效日期' },
                {
                  validator: (_, value: Dayjs) => {
                    const date = value?.format('YYYY-MM-DD');
                    if (date && (date < adjustTarget.startDate || date > adjustTarget.endDate)) {
                      return Promise.reject(new Error(`生效日期必须在目标周期 ${adjustTarget.startDate} 至 ${adjustTarget.endDate} 内`));
                    }
                    return Promise.resolve();
                  }
                }
              ]}
            >
              <DatePicker
                style={{ width: '100%' }}
                disabledDate={(current) => current < dayjs(adjustTarget.startDate).startOf('day') || current > dayjs(adjustTarget.endDate).endOf('day')}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>提交调整</Button>
          </Form>
        ) : null}
      </Modal>
    </Space>
  );
}
