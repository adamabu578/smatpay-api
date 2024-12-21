const { default: mongoose } = require("mongoose");

const chatGroupSchema = new mongoose.Schema({
    groupName: {
        type: String,
        required: true
    },
    chatId: {
        type: mongoose.Schema.Types.ObjectId
        // required: true
    }
})

const chatGroup = mongoose.model('chat group', chatGroupSchema)

module.exports = chatGroup