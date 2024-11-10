const event = require('events');
// const User = require('../models/user');
// const { bot } = require('../controllers/bot');
// const { ROLES } = require('../helpers/consts');

class VEvents extends event.EventEmitter { }

exports.VEVENT_ACCOUNT_CREATED = 'accountCreated';
exports.VEVENT_CHECK_BALANCE = 'checkBalance';
exports.VEVENT_INSUFFICIENT_BALANCE = 'insufficientBalance';
exports.VEVENT_TRANSACTION_ERROR = 'transactionError';
exports.VEVENT_GIVE_BONUS_IF_APPLICABLE = 'giveBonusIfApplicable';

exports.vEvent = new VEvents();

// const VEVENT_ACCOUNT_CREATED = 'accountCreated';
// const VEVENT_CHECK_BALANCE = 'checkBalance';
// const VEVENT_INSUFFICIENT_BALANCE = 'insufficientBalance';
// const VEVENT_TRANSACTION_ERROR = 'transactionError';
// const VEVENT_GIVE_BONUS_IF_APPLICABLE = 'giveBonusIfApplicable';

// const vEvent = new VEvents();

// module.exports = {
//     vEvent, VEVENT_ACCOUNT_CREATED, VEVENT_CHECK_BALANCE, VEVENT_INSUFFICIENT_BALANCE, VEVENT_TRANSACTION_ERROR, VEVENT_GIVE_BONUS_IF_APPLICABLE
// };

// require("./listener");

// this.vEvent.on(this.VEVENT_ACCOUNT_CREATED, async (userID) => {
//     const q = await User.find({ role: ROLES.admin }, { uid: 1 });
//     if (q.length != 0) {
//         bot.sendMessage(q[0].uid?.telegramId, 'REPORT ::: Hurray! An account was just created.')
//     }
// });

// this.vEvent.on(this.VEVENT_CHECK_BALANCE, async (vendor, balance) => {
//     if (isNaN(balance)) return;
//     if (balance > 20000) return;
//     const q = await User.find({ role: ROLES.admin }, { uid: 1 });
//     if (q.length != 0) {
//         bot.sendMessage(q[0].uid?.telegramId, `REPORT ::: Oops! Balance is running low on ${vendor}.`)
//     }
// });

// this.vEvent.on(this.VEVENT_INSUFFICIENT_BALANCE, async (vendor) => {
//     const q = await User.find({ role: ROLES.admin }, { uid: 1 });
//     if (q.length != 0) {
//         bot.sendMessage(q[0].uid?.telegramId, `REPORT ::: Oops! Insufficient balance on ${vendor}.`)
//     }
// });

// this.vEvent.on(this.VEVENT_TRANSACTION_ERROR, async (vendor, msg) => {
//     const q = await User.find({ role: ROLES.admin }, { uid: 1 });
//     if (q.length != 0) {
//         bot.sendMessage(q[0].uid?.telegramId, `REPORT ::: ${vendor} ::: ${msg}`)
//     }
// });

// this.vEvent.on(this.VEVENT_GIVE_BONUS_IF_APPLICABLE, async (referrer, bonus) => {
//     const q = await User.findByIdAndUpdate(referrer, { $inc: { referralBonus: bonus } }, { fields: { 'uid.telegramId': 1 } });
//     if (q?.uid) {
//       bot.sendMessage(q?.uid?.telegramId, `₦${bonus} bonus received`);
//     }
//   });