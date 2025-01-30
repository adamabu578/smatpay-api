const { default: mongoose } = require("mongoose");
const { COMMISSION } = require("../helpers/consts");

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
    token: {
        type: String,
    },
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