const event = require('events');

class VEvents extends event.EventEmitter { }

exports.VEVENT_ACCOUNT_CREATED = 'accountCreated';
exports.VEVENT_CHECK_BALANCE = 'checkBalance';
exports.VEVENT_INSUFFICIENT_BALANCE = 'insufficientBalance';
exports.VEVENT_TRANSACTION_ERROR = 'transactionError';
exports.VEVENT_NEW_REFERRAL = 'newReferral';
exports.VEVENT_GIVE_BONUS_IF_APPLICABLE = 'giveBonusIfApplicable';

exports.vEvent = new VEvents();
