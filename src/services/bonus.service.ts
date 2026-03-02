import { Transaction } from 'sequelize';
import { BonusTransaction } from '../models/BonusTransaction';
import { sequelize } from '../db';

type AppError = Error & { status?: number };

function createAppError(message: string, status: number): AppError {
  const error = new Error(message) as AppError;
  error.status = status;
  return error;
}

export async function getUserBalance(userId: string, transaction: Transaction): Promise<number> {
  const now = new Date();

  const accruals = await BonusTransaction.findAll({
    where: {
      user_id: userId,
    },
    transaction
  });

  const balance = accruals.reduce((sum, tx) => 
    tx.type == 'accrual' ? sum + tx.amount : sum - tx.amount, 
    0
  );

  // TODO: учитывать expires_at
  // TODO: учитывать spend
  // TODO: учитывать конкурентные списания
  return balance;
}

export async function spendBonus(userId: string, requestId: string, amount: number): Promise<boolean> {
  // Legacy-набросок: намеренно наивная реализация для задания.
  // Здесь специально нет транзакции, защиты от гонок и идемпотентности.

  return await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE
    }, async (transaction) => {
      const balance = await getUserBalance(userId, transaction);

      const duplicated = await BonusTransaction.findOne({ 
        where: {
          user_id: userId,
          request_id: requestId,
        },
        transaction
      });

      if(duplicated){
        if(duplicated.amount === amount){
          return true;
        } else {
          throw createAppError('duplicated request id', 409);
        }
      }

      if (balance < amount) {
        throw createAppError('Not enough bonus', 400);
      }

      await BonusTransaction.create({
        user_id: userId,
        type: 'spend',
        amount,
        expires_at: null,
        request_id: requestId,
      }, { transaction });

      return false;
    }
  )
}
