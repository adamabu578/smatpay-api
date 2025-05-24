const { default: mongoose } = require("mongoose");
const { COMMISSION } = require("../helpers/consts");
const { accountNumber } = require("../helpers/params");

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    phone: {
        type: String,
        required: true,
        unique: true,
    },
    balance: {
        type: Number,
        default: 0.00,
    },
    commission: {
        type: Object,
        default: COMMISSION
    },
    token: {
        type: String,
    },
    bvn: {
        type: String,
    },
    accountNumber: {
        type: String,
    },
    bankCode: {
        type: String,
    },
    paystackCustomer: {
        type: {
            code: { type: String },
            isValidated: { type: Boolean, default: false },
        },
    },
    virtualAccounts: [
        {
            bankName: { type: String },
            bankId: { type: Number },
            bankSlug: { type: String },
            accountName: { type: String },
            accountNumber: { type: String },
            currency: { type: String },
            active: { type: Boolean },
        }
    ],
    password: {
        type: String,
        required: true,
        // select: false,
    },
}, {
    timestamps: {
        updatedAt: false,
    }
});

const User = mongoose.model('users', userSchema);

module.exports = User;