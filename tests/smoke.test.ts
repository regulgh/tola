import { BonusTransaction } from '../src/models/BonusTransaction'
import { User } from '../src/models/User';
import { getUserBalance, spendBonus } from '../src/services/bonus.service'
import { bonusQueue } from '../src/queue'
import { QueueEvents } from 'bullmq';
import { redis } from '../src/redis';

describe('Bonus transaction tests', () => {
  let userId: string

  beforeAll(async () => {
    const user = await User.create({ name: 'testUser' })

    userId = user.id
  })

  beforeEach(async () => {
    await BonusTransaction.sync()
    await BonusTransaction.destroy({ where: { user_id: userId }, force: true })

    await bonusQueue.drain(true)
    await bonusQueue.clean(0, 1000, 'completed')
    await bonusQueue.clean(0, 1000, 'failed')
  })

  afterAll(async () => {
    const user = await User.findByPk(userId)
    if(user) user?.destroy()
  })

  it('Повторный запрос на списание с тем же requestId не создает второе списание', async () => {
    await BonusTransaction.create({ type: 'accrual', user_id: userId, amount: 10 })

    const randomString = [...Array(8)].map(() => (Math.random() * 36 | 0).toString(36)).join('')
    const first = await spendBonus(userId, randomString, 1)
    const second = await spendBonus(userId, randomString, 1)

    expect(first).toBe(false)
    expect(second).toBe(true)
  });

  it('Начисление с истекшим сроком действия (accrual) не учитывается в доступном балансе', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    await BonusTransaction.create({ type: 'accrual', user_id: userId, amount: 10 })
    await BonusTransaction.create({ type: 'accrual', user_id: userId, amount: 10, expires_at: yesterday })

    const balance = await getUserBalance(userId)

    expect(balance).toBe(10)
  });

  it('Повторный запрос на списание с тем же requestId не создает второе списание', async () => {
    await BonusTransaction.create({ type: 'accrual', user_id: userId, amount: 10 })

    const randomString = () => [...Array(8)].map(() => (Math.random() * 36 | 0).toString(36)).join('')
    const first = spendBonus(userId, randomString(), 10)
    const second = spendBonus(userId, randomString(), 10)

    await Promise.allSettled([first, second])

    const balance = await getUserBalance(userId)
    expect(balance).toBe(0)
  });

  it('Очередь: повторная обработка/повторная постановка задачи не создает дубли бизнес-эффектов', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    const tx = await BonusTransaction.create({ type: 'accrual', user_id: userId, amount: 10, expires_at: yesterday })

    const expired = await BonusTransaction.findAll({ where: {
      user_id: userId,
      request_id: `expired:${tx.request_id}`
    }})

    expect(expired).toHaveLength(0)

    const queueEvents = new QueueEvents('bonusQueue', { 
      connection: redis.duplicate() as any
    });

    const job1 = await bonusQueue.add('expireAccruals', 
      { createdAt: new Date().toISOString(), },
      { jobId: 'expire-accruals-1' },
    );

    await job1.waitUntilFinished(queueEvents)

    const job2 = await bonusQueue.add('expireAccruals', 
      { createdAt: new Date().toISOString(), },
      { jobId: 'expire-accruals-2' },
    );

    await job2.waitUntilFinished(queueEvents)

    const newExpired = await BonusTransaction.findAll({ where: {
      user_id: userId,
      type: 'spend'
    }})

    expect(newExpired).toHaveLength(1)
  });
});
