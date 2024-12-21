const { default: mongoose } = require("mongoose");

const chatSchema = new mongoose.Schema({
    userId: {
        type: [mongoose.Schema.Types.ObjectId],
        required: true
    },
    roomId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now()
    },
    status: {
        type: Number,
        default: 0
    }
})

const Chat = mongoose.model('chat', chatSchema)

module.exports = Chat