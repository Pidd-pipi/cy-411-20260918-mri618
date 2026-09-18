import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Goal } from './goal';
import { User } from './user';

@Entity('goal_adjustments')
export class GoalAdjustment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'goal_id', type: 'bigint' })
  goalId!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'original_value', type: 'decimal', precision: 12, scale: 2 })
  originalValue!: string;

  @Column({ name: 'new_value', type: 'decimal', precision: 12, scale: 2 })
  newValue!: string;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => Goal, (goal) => goal.adjustments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal!: Goal;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
