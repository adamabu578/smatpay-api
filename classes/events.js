const event = require('events');

class VEvents extends event.EventEmitter { }

exports.VEVENT_ACCOUNT_CREATED = 'accountCreated';
exports.VEVENT_LOW_BALANCE = 'lowBalance';
exports.VEVENT_TRANSACTION_ERROR = 'transactionError';

exports.vEvent = new VEvents();