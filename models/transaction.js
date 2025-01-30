const { default: mongoose } = require("mongoose");

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Types.ObjectId,
        required: true,
    },
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
    serviceId: {
        type: mongoose.Types.ObjectId,
        required: true,
    },
    // serviceVariation: {
    //     type: String,
    // },
    recipient: {
        type: String,
        required: true,
    },
    unitPrice: { //the real unit price
        type: Number,
        required: true,
    },
    quantity: {
        type: Number,
        default: 1,
    },
    commission: {
        type: Number,
    },
    discount: {
        type: Number,
        default: 0,
    },
    amount: { //unit price after removing commission
        type: Number,
        required: true
    },
    totalAmount: { //amount multiply by quantity
        type: Number,
        required: true
    },
    // balanceBefore: {
    //     type: Number,
    //     required: true
    // },
    // balanceAfter: {
    //     type: Number,
    //     required: true
    // },
    // scheduleId: {
    //     type: mongoose.Types.ObjectId,
    // },
    status: {
        type: String,
        default: 'pending'
    },
    statusDesc: {
        type: String,
    },
    tags: {
        type: String,
    },
    refundStatus: {
        type: String,
    },
    respObj: {
        type: Object,
    },
    // rawResp: {
    //     type: Object,
    // }
}, {
    timestamps: {
        updatedAt: false,
    }
});

const Transaction = mongoose.model('transactions', transactionSchema);

// const transactionEventEmitter = Transaction.watch();

// transactionEventEmitter.on('change', change => console.log('transactionEventEmitter', JSON.stringify(change)));

module.exports = Transaction;