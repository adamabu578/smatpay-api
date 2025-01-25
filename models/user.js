const { default: mongoose } = require("mongoose");
const { COMMISSION } = require("../helpers/consts");

const userSchema = new mongoose.Schema({
    uid: {
        type: {
            email: { type: String },
            phone: { type: String },
            telegramId: { type: String },
        },
        required: true,
    },
    name: {
        type: {
            first: { type: String, required: true, },
            last: { type: String, required: true, },
        },
    },
    telegramNumber: {
        type: String
    },
    role: {
        type: String
    },
    balance: {
        type: Number,
        default: 0.00,
    },
    commission: {
        type: Object,
        default: COMMISSION
    },
    testKey: {
        type: String,
        required: true,
        unique: true,
        // default: 'tk' + uid(20)
    },
    liveKey: {
        type: String,
        required: true,
        unique: true,
        // default: 'lk' + uid(20)
    },
    // keys: {
    //     type: {
    //         test: {
    //             type: String, required: true, unique: true,
    //             // default: 'tk' + uid(20)
    //         },
    //         live: {
    //             type: String, required: true, unique: true,
    //             // default: 'lk' + uid(20) 
    //         },
    //     },
    // },
    referralCode: {
        type: String,
        required: true,
        unique: true,
    },
    referrer: {
        type: mongoose.Types.ObjectId
    },
    referralBonus: {
        type: Number,
        default: 0.00,
    },
    fcmToken: {
        type: String,
    },
    password: {
        type: String,
    },
}, {
    timestamps: {
        updatedAt: false,
    }
});

const User = mongoose.model('users', userSchema);

module.exports = User;