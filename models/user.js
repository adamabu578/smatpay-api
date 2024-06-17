const { default: mongoose } = require("mongoose");
const { uid } = require("uid");

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
        unique: true
    },
    phone: {
        type: String,
        required: true,
        unique: true
    },
    emailStatus: {
        type: String,
        default: 'pending'
    },
    phoneStatus: {
        type: String,
        default: 'pending'
    },
    testKey: {
        type: String,
        required: true,
        unique: true,
        default: 'tk' + uid(20),
    },
    liveKey: {
        type: String,
        required: true,
        unique: true,
        default: 'lk' + uid(20),
    },
    password: {
        type: String,
        required: true,
    },
}, {
    timestamps: {
        updatedAt: false,
    }
});

const User = mongoose.model('users', userSchema);

module.exports = User;