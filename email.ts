import sgMail from '@sendgrid/mail';
import { stringify } from 'csv-stringify';
import Joi from 'joi';
import mjml2html from 'mjml';
import config from '../config/config';
import logger from '../config/logger';
import { Roles } from '../types/d';
import clientRoute from './clientRoutes';
import messages from './messages';
import { isProdOrStage } from './system';
import { PhoneAndName } from './utils.d';

export type Attachment = Array<{
  content: string;
  filename: string;
  type: string;
  disposition: string;
  content_id?: string;
}>;

const validateSendEmail = (request: {
  htmlEmailTemplateName: string;
  toEmail: string;
  subject: string;
  data: {};
}) => {
  const schema = Joi.object().keys({
    subject: Joi.string().required(),
    toEmail: Joi.string().required(),
    htmlEmailTemplateName: Joi.string().required(),
    data: Joi.object().keys(),
  });
  const validation = schema.validate(request, { abortEarly: false });

  if (validation.error) {
    throw new Error(JSON.stringify(validation.error.details));
  }
};

sgMail.setApiKey(config.sendgrid.sendGridApiKey);
const isEmailEnabled = !!isProdOrStage;

const fromEmail = 'friend@errandlr.com';
const fromName = 'Errandlr';

const sendEmail = async (
  htmlEmailTemplateName: string,
  toEmail: string,
  subject: string,
  data = {},
  attachments: Attachment = [],
  copyInMail?: string
) => {
  validateSendEmail({ htmlEmailTemplateName, toEmail, subject, data });
  const path = `../templates/mailTemplates/${htmlEmailTemplateName}`;
  const fileTemplate = require(path);
  const pathToHtmlEmailTemplate = mjml2html(fileTemplate(data));

  if (pathToHtmlEmailTemplate.errors.length) {
    console.trace(pathToHtmlEmailTemplate.errors);
  } else {
    const msg = {
      to: toEmail,
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject,
      html: pathToHtmlEmailTemplate.html,
      attachments,
      ...(copyInMail && { cc: copyInMail }),
    };

    return sgMail
      .send(msg)
      .then(() => {
        logger.info(`Sent email with template ${htmlEmailTemplateName} to ${toEmail}`);
        return true;
      })
      .catch((error) => {
        console.log(JSON.stringify(error));
        console.trace(error);
        return false;
      });
  }
};

export const sendVerificationPinEmail = (
  toEmail: string,
  payload: { pin: string; name: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;
  const subject = 'Verify Your Email - Errandlr';
  return sendEmail('verification-pin', toEmail, subject, payload, attachment);
};

export const sendForgotPasswordEmail = (
  toEmail: string,
  payload: { code: string; name: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Forgot Password - Errandlr';
  const data = {
    code: payload.code,
    name: payload.name,
  };

  return sendEmail('forgot-password', toEmail, subject, data, attachment);
};

export const sendRequestCreatedEmail = (
  toEmail: string,
  payload: {
    name: string;
    trackingId: string;
    pickupCode: string;
    senderName: string;
    senderPhoneNumber: string;
    senderAddress: string;
    recipientName: string;
    recipientPhoneNumber: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;
  const subject = 'Request Created - Errandlr';
  const data = {
    ...payload,
    name: payload.name,
    tracking_url: clientRoute.requestTrackingUrl(payload.trackingId),
    tracking_id: payload.trackingId,
    pickup_code: payload.pickupCode,
  };

  return sendEmail('request-created', toEmail, subject, data, attachment);
};

export const sendMeterPurchasedEmail = (
  toEmail: string,
  payload: {
    amount: number;
    name: string;
    address: string;
    meterNo: string;
    paymentToken: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;
  const subject = 'Utility Purchased - Errandlr';
  const data = { ...payload };
  return sendEmail('meter-purchased', toEmail, subject, data, attachment);
};

export const sendLocalBankTransferReceipt = (
  toEmail: string,
  payload: {
    amount: number;
    receiverName: string;
    receiverAccountNumber: string;
    receiverBank: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;
  const subject = 'Transfer Succesful - Errandlr';
  const data = { ...payload };
  return sendEmail('local-bank-outward-transfer', toEmail, subject, data, attachment);
};

export const sendBatchRequestCreatedEmail = (
  toEmail: string,
  payload: { name: string; trackingId: string; pickupCode: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Batch Request Created - Errandlr';
  const data = {
    message: messages.BATCH_REQUEST_CREATED(payload.trackingId),
    name: payload.name,
    tracking_url: clientRoute.redirectToTrackUrl(),
    tracking_id: payload.trackingId,
    pickup_code: payload.pickupCode,
  };

  return sendEmail('batch-created', toEmail, subject, data, attachment);
};

export const sendRequestCreatedEmailForOpenApi = (
  toEmail: string,
  payload: { name: string; businessName: string; trackingId: string; pickupCode: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Request Created - ${payload.businessName}`;
  const data = {
    message: messages.OPEN_API_REQUEST_CREATED(
      payload.businessName,
      payload.trackingId,
      false
    ),
    name: payload.name,
    tracking_url: clientRoute.requestTrackingUrl(payload.trackingId),
    tracking_id: payload.trackingId,
    pickup_code: payload.pickupCode,
  };

  return sendEmail('open-api-request-created', toEmail, subject, data, attachment);
};

export const sendWalletFailedEmail = (
  toEmail: string,
  payload: { name: string; trackingId: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Billing Failed - Errandlr';
  const data = {
    tracking_url: clientRoute.requestTrackingUrl(payload.trackingId),
    name: payload.name,
    tracking_id: payload.trackingId,
  };

  return sendEmail('wallet-failed', toEmail, subject, data, attachment);
};

export const sendPendingBatchEmail = (
  toEmail: string,
  payload: { name: string; trackingId: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Pending Batch - Errandlr';
  const data = {
    name: payload.name,
  };

  return sendEmail('pending-batch', toEmail, subject, data, attachment);
};

export const sendRequestAcceptedEmail = (
  toEmail: string,
  payload: {
    name: string;
    trackingId: string;
    pickupAddress: { fullAddress: string };
    deliverToInformation: PhoneAndName[];
    message: string;
    dispatcher: {
      name: string;
      phone?: string;
    };
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Request Accepted - Errandlr';
  const { deliverToInformation, pickupAddress, name, trackingId, message, dispatcher } =
    payload;

  const data = {
    message,
    tracking_url: clientRoute.checkRequestStatusUrl(trackingId),
    name,
    pickupAddress: pickupAddress.fullAddress,
    deliverToInformation,
    tracking_id: trackingId,
    dispatcher,
  };

  return sendEmail('request-accepted', toEmail, subject, data, attachment);
};

export const sendSuccessfulPayoutEmail = (
  toEmail: string,
  payload: {
    name: string;
    accountName: string;
    accountNumber: string;
    bankName: string;
    amount: number;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Your Errandlr Payouts';
  const data = {
    name: payload.name,
    accountName: payload.accountName,
    bankName: payload.bankName,
    accountNumber: payload.accountNumber,
    amount: payload.amount,
  };

  return sendEmail('success-payout', toEmail, subject, data, attachment);
};

export const sendRegistrationEmail = (
  toEmail: string,
  payload: { name: string; role: Roles },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Welcome To Errandlr';
  const data = {
    name: payload.name,
  };
  const path = `registration-${payload.role}`;
  return sendEmail(path, toEmail, subject, data, attachment);
};

export const sendQueryOpenedEmail = (
  toEmail: string,
  payload: { name: string; queryId: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Query Opened - Errandlr';
  const data = {
    tracking_url: clientRoute.queryUrl(payload.queryId),
    name: payload.name,
  };

  return sendEmail('query-opened', toEmail, subject, data, attachment);
};

export const sendRequestCancelledEmail = (
  toEmail: string,
  payload: { name: string; trackingId: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Request Cancelled[${payload.trackingId}]`;
  const data = {
    tracking_url: clientRoute.requestTrackingUrl(payload.trackingId),
    name: payload.name,
    tracking_id: payload.trackingId,
  };

  return sendEmail('request-cancelled', toEmail, subject, data, attachment);
};

export const sendRequestCompletedEmail = (
  toEmail: string,
  payload: {
    name: string;
    trackingId: string;
    pickupAddress: string;
    deliverToInformation: PhoneAndName[];
    requestEstimate: number;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Request Completed[${payload.trackingId}]`;
  const data = {
    name: payload.name,
    deliveryId: payload.trackingId,
    pickupAddress: payload.pickupAddress,
    deliverToInformation: payload.deliverToInformation,
    requestEstimate: payload.requestEstimate,
  };

  return sendEmail('request-completed', toEmail, subject, data, attachment);
};

export const sendPasswordChangedEmail = (
  toEmail: string,
  payload: { name: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Password Changed - Errandlr';
  const data = {
    name: payload.name,
  };

  return sendEmail('password-changed', toEmail, subject, data, attachment);
};

export const sendAccountUnderReviewEmail = (
  toEmail: string,
  payload: { name: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = 'Account under Review - Errandlr';

  return sendEmail('account-verification', toEmail, subject, payload, attachment);
};

export const sendPayoutRequestMail = (
  toEmail: string,
  payload: {
    name: string;
    bankDetails: { bankName: string; accountName: string; accountNumber: string };
    amount: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Payout Requested[${payload.amount}]`;
  return sendEmail('payout-requested', toEmail, subject, payload, attachment);
};

export const sendAccountVerifiedEmail = (
  toEmail: string,
  payload: {
    name: string;
    slug: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Account Verified`;
  return sendEmail('account-verified', toEmail, subject, {
    ...payload,
    slug: clientRoute.dispatcherSlugUrl(payload.slug),
    attachment,
  });
};

export const sendBillingFailedEmail = (
  toEmail: string,
  payload: {
    name: string;
    trackingId: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const data = {
    name: payload.name,
    tracking_id: payload.trackingId,
    tracking_url: clientRoute.requestTrackingUrl(payload.trackingId),
  };

  const subject = `Billing Failed`;
  return sendEmail('billing-failed', toEmail, subject, data, attachment);
};

export const sendWalletFundedEmail = (
  toEmail: string,
  payload: {
    name: string;
    balance: number;
    amount: number;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Wallet Topup Successful`;
  return sendEmail('wallet-funded', toEmail, subject, payload, attachment);
};

export const sendDirectBookingEmail = (
  toEmail: string,
  payload: { trackingId: string; name: string },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Direct Booking Request`;
  return sendEmail('direct-booking', toEmail, subject, payload, attachment);
};

export const sendQuoteReplyEmail = (
  toEmail: string,
  payload: {
    trackingId: string;
    companyName: string;
    amount: string;
    emailRecipient: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;

  const subject = `Quote has Arrived - ${payload.companyName}`;
  const data = {
    redirect_url: clientRoute.confirmOrderDetails(payload.trackingId),
    ...payload,
  };

  return sendEmail('quote-reply', toEmail, subject, data, attachment);
};

export const sendCsvEmail = async (
  toEmail: string,
  subject: string,
  payload: { name: string; trackingId: string },
  csvData: string[][],
  templateName: string,
  copyInMail?: string
) => {
  if (!isEmailEnabled) return true;
  stringify(csvData, (err: any, output: any) => {
    let buff = Buffer.from(output);
    let base64data = buff.toString('base64');
    const atta = [
      {
        content: base64data,
        filename: 'record.csv',
        type: 'text/csv',
        disposition: 'attachment',
      },
    ];
    return sendEmail(templateName, toEmail, subject, payload, atta, copyInMail);
  });
};
export const sendWarningOrCriticalBalanceEmail = (
  toEmail: string,
  payload: {
    amount: number;
    type: string;
  }
) => {
  if (!isEmailEnabled) return true;

  const data = {
    amount: payload.amount,
    type: payload.type,
  };

  let subject = `[Important] Your Errandlr Balance is low`;
  if (payload.type === 'critical') {
    subject = `[Important] Your Errandlr Balance is critically low`;
  }

  return sendEmail('warning-or-critical-balance', toEmail, subject, data);
};

export const sendEventTicketPurchasedEmail = (
  toEmail: string,
  payload: {
    name: string;
    eventName: string;
    amountPaid: number;
    quantity: number;
    eventDate: string;
    eventTimeZone: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;
  const subject = 'Event Ticket Purchased - Errandlr';
  const data = { ...payload };
  return sendEmail('event-ticket', toEmail, subject, data, attachment);
};

export const successCurrencyChangeEmail = (
  toEmail: string,
  payload: {
    customerName: string;
    currency: string;
    amount: string;
    amountInNaira: number;
    trxnRef: string;
  },
  attachment: Attachment = []
) => {
  if (!isEmailEnabled) return true;
  const subject = `Your money's arrived`;
  const data = {
    customerName: payload.customerName,
    currency: payload.currency,
    amount: payload.amount,
    amountInNaira: payload.amountInNaira,
    trxnRef: payload.trxnRef,
  };
  return sendEmail('success-currency-change', toEmail, subject, data, attachment);
};
