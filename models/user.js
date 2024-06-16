const { default: mongoose } = require("mongoose");

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
        type: Number,
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
    password: {
        type: String,
        required: true,
    },
});

const User = mongoose.model('users', userSchema);

module.exports = User;