const { default: mongoose } = require("mongoose");

const sessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Types.ObjectId,
        required: true,
    },
    options: {
        type: {},
        // required: true,
    },
    isClosed: {
        type: Number,
        default: 0,
    },
});

const Session = mongoose.model('sessions', sessionSchema);

module.exports = Session;