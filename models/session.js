const { default: mongoose } = require("mongoose");

const sessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Types.ObjectId,
    },
    telegramId: {
        type: String,
    },
    startParams: {
        type: String,
    },
    options: {
        type: {},
    },
    data: {
        type: {},
    },
    isClosed: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: { updatedAt: false }
});

const Session = mongoose.model('sessions', sessionSchema);

module.exports = Session;