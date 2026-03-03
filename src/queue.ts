import { Queue, Worker } from 'bullmq';

import { redis } from './redis';
import { sequelize } from './db';
import { Op, Transaction } from 'sequelize';
import { BonusTransaction } from './models/BonusTransaction';

const queueConnection = redis.duplicate();

export const bonusQueue = new Queue('bonusQueue', {
  connection: queueConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    }
  }
});

let expireAccrualsWorker: Worker | null = null;

export function startExpireAccrualsWorker(): Worker {
  if (expireAccrualsWorker) {
    return expireAccrualsWorker;
  }

  expireAccrualsWorker = new Worker(
    'bonusQueue',
    async (job) => {
      if (job.name === 'expireAccruals') {
        console.log(`[worker] expireAccruals started, jobId=${job.id}`);

        const now = new Date()

        await sequelize.transaction(
          {
            isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE
          },
          async (transaction) => {
            const accruals = await BonusTransaction.findAll(
              {
                where: {
                  type: 'accrual',
                  expires_at: {
                    [Op.lt]: now,
                  }
                },

                transaction
              }
            )

            for(const acc of accruals){
              const requestId = `expire:${acc.id}`

              const spend = await BonusTransaction.findOne({
                where: {
                  type: 'spend',
                  request_id: requestId,
                },

                transaction
              })

              if(!spend){
                await BonusTransaction.create({
                  user_id: acc.user_id,
                  type: 'spend' as 'spend',
                  amount: acc.amount,
                  expires_at: null,
                  request_id: `expire:${acc.id}`,
                }, { transaction })
              }

              acc.expires_at = null
              await acc.save({ transaction })
            }
          }
        )
      }
    },
    {
      connection: redis.duplicate() as any,
    },
  );

  expireAccrualsWorker.on('failed', (job, err) => {
    console.error(`[worker] failed, jobId=${job?.id}`, err);
  });

  return expireAccrualsWorker;
}
