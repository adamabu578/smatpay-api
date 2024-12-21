const express = require('express')
const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const catchAsync = require("../utils/catchAsync");
const chatGroup = require('../models/chatGroupModel');
// const http = require("http").createServer(express);
// const io = require('socket.io')(3002)

exports.createChat = catchAsync(async (req, res, next) => {
    // const userId = req.user.userId
    // const message = req.body.message

    // io.on("connection", (socket) => {
    //     socket.on("join", async (userId) => {
    //         if (userId) {
    //             socket.join(userId);

    //             socket.emit("message", "Welcome to the chat");

    //             socket.to(userId).emit("message", "A new user joined the chat!")
    //         } else {
    //             socket.emit("message", "Your User Id is not valid")
    //         }
    //     });

    //     socket.on("message", (message) => {
    //         const chat = new Chat({ userId: message.userId, message });
    //         chat.save();
    //         io.emit("message", chat);
    //     });
    // });

    const q = await chatModel.find().sort({ createdAt: 1 });
    res.status(200).json(q);
})

exports.createChatGroup = catchAsync(async (req, res, next) => {
    const groupName = req.body.groupName

    const ChatGroup = new chatGroup({
        groupName,
    })

    await ChatGroup.save()

    const q = await chatGroup.findOne({ _id: ChatGroup._id })

    res.status(200).json({ status: 'success', msg: 'Chat Group Created', data: q })
})
