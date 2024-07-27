const event = require('events');

class VEvents extends event.EventEmitter { }

exports.VEVENT_ACCOUNT_CREATED = 'accountCreated';
exports.VEVENT_LOW_BALANCE = 'lowBalance';

exports.vEvent = new VEvents();