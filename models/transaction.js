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
    recipient: {
        type: String,
        required: true,
    },
    unitPrice: {
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
    amount: {
        type: Number,
        required:true
    },
    totalAmount: {
        type: Number,
        required:true
    },
    balanceBefore: {
        type: Number,
        required:true
    },
    balanceAfter: {
        type: Number,
        required:true
    },
    scheduleId: {
        type: mongoose.Types.ObjectId,
    },
    status: {
        type: String,
        default: 'pending'
    },
    statusDesc: {
        type: String,
    },
    tags: {
        type: [],
    },
    refundStatus: {
        type: String,
    },
    respObj: {
        type: Object,
    },
    rawResp: {
        type: Object,
    }
}, {
    timestamps: {
        updatedAt: false,
    }
});

const Transaction = mongoose.model('transactions', transactionSchema);

module.exports = Transaction;