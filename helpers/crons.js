const cron = require('node-cron');
const fetch = require('node-fetch');
const randtoken = require('rand-token');
const Transaction = require('../models/transaction');
const { REFUND_STATUS, TRANSACTION_STATUS } = require('./consts');
const User = require('../models/user');

const autoRecharge = async () => {
    try {

    } catch (err) {
        console.log('helpers :::', 'cronJobs :::', 'autoRecharge :::', 'ERROR :::', err.message);
    }
}

const refund = async () => {
    try {
        const q = await Transaction.find({ status: TRANSACTION_STATUS.FAILED, refundStatus: REFUND_STATUS.PENDING }, { userId: 1, totalAmount: 1 });
        for (let i = 0; i < q.length; i++) {
            const q2 = await User.updateOne({ _id: q[i].userId }, { $inc: { balance: q[i].totalAmount } });
            if (q2?.modifiedCount == 1) {
                await Transaction.updateOne({ _id: q[i]._id }, { refundStatus: REFUND_STATUS.REFUNDED });
            }
        }
    } catch (err) {
        console.log('helpers :::', 'cronJobs :::', 'refund :::', 'ERROR :::', err.message);
    }
}

// cron.schedule('*/3 * * * * *', autoRecharge); //every 3sec
cron.schedule('*/5 * * * * *', refund); //every 5sec

// exports.autoRecharge = autoRecharge;