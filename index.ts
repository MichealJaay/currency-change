import { openRequestFromPlatform } from '@controllers/services/request.service';
import osCrypto from 'crypto';
import * as express from 'express';
import httpStatus from 'http-status';
import config from '../../config/config';
import logger from '../../config/logger';
import { FailedPaymentTransaction, Wallet } from '../../database/models';
import AppError from '../../utils/AppError';
import { RedisCache as redis } from '../../utils/cache';
import catchAsync from '../../utils/catchAsync';
import { sendWalletFundedEmail } from '../../utils/email';
import { PAYSTACK_BASE_API, makePaystackHttpPostRequest } from '../../utils/helpers';
import { successCurrencyChangeEmail } from '../../utils/email';

import {
  WALLET_FUNDS_MOVEMENT_IDENTIFIER,
  processAccountSubscriberFinanceCredit,
} from '@controllers/services/banking.service';
import { UserModel } from '@database/d';
import slackMessage from '@templates/slackMessages';
import { sendNotificationToMobileDevice } from '@utils/firebase';
import { getSafeHaven } from '@utils/SafeHavenServices';
import Slack from '@utils/slack';
import mongoose from 'mongoose';
import {
  BulkTransferPayloadType,
  CardSignature,
  RecipientType,
  TransferRecipient,
} from './d';
import { webhookListenerService } from './payment.service';
import {
  validateBulkTransfer,
  validateCreateTransferRecipient,
  validateSingleTransfer,
} from './validations';

const sendWalletFundedMobileNotification = async (account: UserModel, amount: number) => {
  const deviceToken = account.deviceToken;
  const userId = account.id;
  const title = 'Wallet Funded';
  const body = `Your wallet has been funded with N${Number(amount).toLocaleString()}`;
  sendNotificationToMobileDevice(
    { deviceToken, title, body, channel: 'commerce' },
    { userId }
  );
};

export const webhookListener = async (req: express.Request, res: express.Response) => {
  //validate event
  res.sendStatus(200);
  let hash = osCrypto
    .createHmac('sha512', config.paystackSecretKey)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash == req.headers['x-paystack-signature']) {
    // Retrieve the request's body
    let response = req.body;
    await webhookListenerService(response);
  }
};

export const singlePayout = async (
  amount: number,
  recipient: string,
  reason?: string,
  metadata?: any
) => {
  try {
    validateSingleTransfer({ amount, recipient });
    const params: RecipientType = {
      source: 'balance',
      amount: amount * 100,
      recipient,
      reason,
      metadata,
    };

    const response = await makePaystackHttpPostRequest(
      `${PAYSTACK_BASE_API}/transfer`,
      params
    );
    return response;
  } catch (error) {
    logger.error('Error failed during payout', error);
  }
};

export const bulkPayout = async (transfers: RecipientType[]) => {
  try {
    validateBulkTransfer(transfers);
    const params: BulkTransferPayloadType = {
      currency: 'NGN',
      source: 'balance',
      transfers,
    };

    const response = await makePaystackHttpPostRequest(
      `${PAYSTACK_BASE_API}/transfer/bulk`,
      params
    );
    return response;
  } catch (error) {
    logger.error('Error failed during payout', error);
  }
};
/**
 * Returns a list of nigerian bank providers with custom code
 * @param {*} _
 * @param {*} res Response
 * @todo add tests
 */
export const getBankProviders = catchAsync(
  async (_: express.Request, res: express.Response) => {
    const getCachedResponse = await redis.get('bank-providers-list');

    if (getCachedResponse) {
      return res.json(getCachedResponse);
    }

    const safeHaven = await getSafeHaven();
    const banks = await safeHaven.getAllBanks();

    const expiry_time = 1000 * 60 * 60 * 24 * 7; //1week

    if (!banks?.data?.length) {
      throw new AppError(
        httpStatus.FAILED_DEPENDENCY,
        'Unable to request bank providers'
      );
    }

    const filterResult = banks.data.map((r: { name: string; bankCode: string }) => ({
      name: r.name,
      slug: r.name,
      code: r.bankCode,
    }));
    redis.setTTl(expiry_time);
    await redis.set('bank-providers-list', filterResult);
    return res.json(filterResult);
  }
);

/**
 * Create a transfer recipient
 * @url https://paystack.com/docs/transfers/single-transfers/#create-a-transfer-recipient
 * @namespace
 * @property {object} request
 * @property {string} request.type
 * @property {string} request.name
 * @property {string} request.account_number
 * @property {string} request.bank_code
 * @property {string} request.currency
 */
export const createTransferRecipient = async (request: TransferRecipient) => {
  validateCreateTransferRecipient(request);
  const { type = 'nuban', name, account_number, bank_code, currency = 'NGN' } = request;
  const params = {
    type,
    name,
    account_number,
    bank_code,
    currency,
  };
  const response = await makePaystackHttpPostRequest(
    `${PAYSTACK_BASE_API}/transferrecipient`,
    params
  );
  if (response.status) {
    return response;
  }

  throw new AppError(httpStatus.FAILED_DEPENDENCY, response.message);
};

export const verifyBankInformation = catchAsync(
  async (req: express.Request, res: express.Response) => {
    const { account_number, bank_code } = req.query as any;
    const safeHavenService = await getSafeHaven();
    const response = await safeHavenService.getNameEnquiry({
      bankCode: bank_code,
      accountNumber: account_number,
    });

    if (!response?.data) {
      throw new AppError(httpStatus.FAILED_DEPENDENCY, 'Unable to verify account number');
    }
    return res.json({
      account_name: response.data.accountName,
      account_number: response.data.accountNumber,
      bank_id: response.data.bankCode,
      message: response.data.responseMessage,
      status: true,
    });
  }
);

interface UpdateUserWallet extends CardSignature {
  metadata: {
    isPlatformRequest: boolean;
    request: string;
    senderId: string;
    accountId: string;
    requestWithGeoHash: {
      geoId: string;
      batch: boolean;
    };
  };
}

export const updateUserWallet = async (data: UpdateUserWallet) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const senderId = data.metadata.senderId;

    if (!senderId || (senderId && !senderId.match(/^[0-9a-fA-F]{24}$/))) {
      return logger.error({ message: 'Invalid senderId Paystack', response: data });
    }
    const wallet = (await Wallet.findOne({ roleId: senderId })
      .session(session)
      .populate<{ account: UserModel }>('account'))!;
    const amountInNaira = data.amount / 100;
    const walletNewBalance = Number(wallet.balance) + amountInNaira;

    await wallet.updateOne(
      {
        $inc: { balance: amountInNaira },
        $push: {
          record: {
            type: 'credit',
            amount: amountInNaira,
            balancePreOperation: Number(wallet.balance),
            balancePostOperation: walletNewBalance,
            accountNumber: '000000000',
            senderName: (data.authorization as any).account_name as string,
            senderAccountNumber: '000000',
            bankCode: '000',
            reference: data.reference,
            narration: 'PAYSTACK DIRECT UPDATE',
          },
        },
      },
      {
        session,
      }
    );

    if (!wallet) {
      await session.abortTransaction();
      return logger.error({ message: 'Account match not found', response: data });
    }

    if (wallet.accountDetails) {
      await processAccountSubscriberFinanceCredit({
        amount: amountInNaira,
        accountDetails: {
          name: wallet.accountDetails?.name,
          number: wallet.accountDetails?.number,
        },
        narration: WALLET_FUNDS_MOVEMENT_IDENTIFIER,
      });
    }

    sendWalletFundedEmail(wallet.account.email, {
      name: wallet.account.firstname,
      amount: amountInNaira,
      balance: walletNewBalance,
    });

    if (data.metadata.isPlatformRequest) {
      openRequestFromPlatform(data.metadata, senderId);
    }
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error({
      message: 'Error occured updating wallet',
      metadata: {
        data,
        error,
      },
    });
    logger.error({
      message: 'Error occured updating wallet',
      metadata: {
        data,
        error,
      },
    });
    //do a head log here
  } finally {
    session.endSession();
  }
};

export const updateWalletByPaystackNuban = async (data: {
  customer_code: string;
  receiver_bank_account_number: string;
  amount: number;
  reference: string;
  authorization: { account_name: string };
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = (await Wallet.findOne({
      paystackCustomerCode: data.customer_code,
      paystackAccountNumber: data.receiver_bank_account_number,
    })
      .session(session)
      .populate<{ account: UserModel }>('account'))!;
    const amountInNaira = data.amount / 100;
    const walletNewBalance = Number(wallet.balance) + amountInNaira;

    await wallet.updateOne(
      {
        $inc: { balance: amountInNaira },
        $push: {
          record: {
            type: 'credit',
            amount: amountInNaira,
            balancePreOperation: Number(wallet.balance),
            balancePostOperation: walletNewBalance,
            accountNumber: '000000000',
            senderName: (data.authorization as any).account_name as string,
            senderAccountNumber: '000000',
            bankCode: '000',
            reference: data.reference,
            narration: 'PAYSTACK NUBAN WALLET',
          },
        },
      },
      { session }
    );

    if (!wallet) {
      await session.abortTransaction();
      return logger.error({ message: 'Account match not found', response: data });
    }

    if (wallet.accountDetails) {
      await processAccountSubscriberFinanceCredit({
        amount: amountInNaira,
        accountDetails: {
          name: wallet.accountDetails?.name,
          number: wallet.accountDetails?.number,
        },
        narration: WALLET_FUNDS_MOVEMENT_IDENTIFIER,
      });
    }

    await session.commitTransaction();

    sendWalletFundedEmail(wallet.account.email, {
      name: wallet.account.firstname,
      amount: amountInNaira,
      balance: walletNewBalance,
    });
    sendWalletFundedMobileNotification(wallet.account, amountInNaira);
  } catch (error) {
    await session.abortTransaction();
    logger.error({
      message: 'Error occured updating wallet',
      metadata: {
        data,
        error,
      },
    });
  } finally {
    session.endSession();
  }
};

export const reprocessQueuedPayments = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const failedPayments = await FailedPaymentTransaction.find({
      reason: 'Your balance is not enough to fulfil this request',
    }).lean();

    if (!failedPayments.length) {
      return res
        .status(httpStatus.OK)
        .send({ success: true, message: 'There are no failed payment transactions' });
    }

    const transfers: RecipientType[] = failedPayments.map((failedPayment) => ({
      amount: Number(failedPayment.amount),
      recipient: failedPayment.recipient_code,
      reason: 'Errandlr Payout',
    }));

    const bulkPayoutResponse = await bulkPayout(transfers);

    if (bulkPayoutResponse.status) {
      for (const failedPayment of failedPayments) {
        const notificationPayload = {
          roleId: failedPayment.role_id,
          role: failedPayment.role,
          amount: Number(failedPayment.amount),
        };
        await Promise.all([
          Wallet.findOneAndUpdate(
            { roleId: failedPayment.role_id },
            {
              $push: {
                record: {
                  type: 'debit',
                  amount: failedPayment.amount,
                  accountNumber: '000000',
                  senderName: 'Errandlr',
                  senderAccountNumber: '0000',
                  bankCode: '00000',
                  reference: failedPayment.reference,
                  narration: '',
                },
              },
              balance: 0,
            },
            { new: true }
          ),

          Slack.sendToNotificationChannel({
            type: 'block',
            block: slackMessage.newWithdrawalPayout(notificationPayload),
            channelId: config.slack.RequestPayoutConversationID,
          }),
          FailedPaymentTransaction.findOneAndDelete({ _id: failedPayment._id }),
        ]);
      }

      res.status(httpStatus.OK).send({ success: true });
    }
  } catch (error) {
    logger.error('Error failed during payout', error);
  }
};

/**
 * Used for international transactions only
 * @param data
 * @returns
 */
export const updateUserWalletViaIntlChannel = async (data: {
  roleId: string;
  amountInNaira: number;
  currency: string;
  amount: string;
  customerName: string;
  trxnRef: string;
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { amountInNaira, roleId, customerName, trxnRef, currency, amount } = data;
    const wallet = (await Wallet.findOne({ roleId: roleId })
      .session(session)
      .populate<{ account: UserModel }>('account'))!;
    const walletNewBalance = Number(wallet.balance) + amountInNaira;

    await wallet.updateOne(
      {
        $inc: { balance: amountInNaira },
        $push: {
          record: {
            type: 'credit',
            amount: amountInNaira,
            balancePreOperation: Number(wallet.balance),
            balancePostOperation: walletNewBalance,
            accountNumber: '000000000',
            senderName: customerName,
            senderAccountNumber: '000000',
            bankCode: '000',
            reference: trxnRef,
            narration: `INFLOW - ${currency} ${amount}`,
          },
        },
      },
      { session }
    );

    if (!wallet) {
      await session.abortTransaction();
      return logger.error({ message: 'Account match not found', response: data });
    }

    if (wallet.accountDetails) {
      await processAccountSubscriberFinanceCredit({
        amount: amountInNaira,
        accountDetails: {
          name: wallet.accountDetails?.name,
          number: wallet.accountDetails?.number,
        },
        narration: WALLET_FUNDS_MOVEMENT_IDENTIFIER,
      });
    }

    await session.commitTransaction();
    successCurrencyChangeEmail(wallet.account.email, {
      customerName,
      amount,
      currency,
      amountInNaira,
      trxnRef,
    });
    sendWalletFundedMobileNotification(wallet.account, amountInNaira);
  } catch (error) {
    await session.abortTransaction();
    logger.error({
      message: 'International Payment: Error occured updating wallet',
      metadata: {
        data,
        error,
      },
    });
  } finally {
    session.endSession();
  }
};
