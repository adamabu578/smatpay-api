const { default: mongoose } = require("mongoose");
const catchAsync = require("../helpers/catchAsync");
const AppError = require("../helpers/AppError");
const User = require("../models/user");
const Transaction = require("../models/transaction");
const Service = require("../models/service");
const P = require("../helpers/params");
const { pExCheck, genRefNo } = require("../helpers/utils");
const { TRANSACTION_STATUS, DEFAULT_LOCALE, TIMEZONE } = require("../helpers/consts");

exports.dashboardMetrics = catchAsync(async (req, res, next) => {
  const usersCount = await User.countDocuments();
  const transactionsCount = await Transaction.countDocuments();
  const pendingTransactions = await Transaction.countDocuments({ status: TRANSACTION_STATUS.PENDING });
  
  const totalWalletBalances = await User.aggregate([
    { $group: { _id: null, total: { $sum: "$balance" } } }
  ]);

  res.status(200).json({
    status: 'success',
    msg: 'Dashboard metrics fetched',
    data: {
      usersCount,
      transactionsCount,
      pendingTransactions,
      totalWalletBalance: totalWalletBalances[0]?.total || 0,
    }
  });
});

exports.listTransactions = catchAsync(async (req, res, next) => {
  const maxPerPage = 50;
  let { id, recipient, status, page, perPage, order, search } = req.query;
  page = parseInt(page, 10) || 1;
  perPage = parseInt(perPage, 10) || maxPerPage;
  perPage = perPage > maxPerPage ? maxPerPage : perPage;

  const filter = {};
  if (id) filter.transactionId = { $in: id.split(',').filter(i => i != '') };
  if (recipient) filter.recipient = { $in: recipient.split(',').filter(i => i != '') };
  if (status && status !== 'all') filter.status = status;
  if (search) {
      filter.$or = [
          { transactionId: { $regex: search, $options: 'i' } },
          { recipient: { $regex: search, $options: 'i' } }
      ];
  }

  const arr = [
    { $sort: { _id: order?.toLowerCase() == 'asc' ? 1 : -1 } },
    { $skip: (page - 1) * perPage },
    { $limit: perPage },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { service: '$serviceId', recipient: 1, unitPrice: 1, quantity: 1, amount: 1, totalAmount: 1, balanceBefore: 1, balanceAfter: 1, status: 1, createdAt: 1, meta: 1, 'user.firstName': 1, 'user.lastName': 1, 'user.email': 1 } }
  ];

  const _q = await Transaction.aggregate([
    { $match: filter },
    { $facet: { count: [{ $count: 'total' }], data: arr } }
  ]);

  const q = _q[0].data;
  const serviceIDs = [...new Set(q.map(i => i.service.toHexString()))];
  const servicesData = await Service.find({ _id: { $in: serviceIDs } });
  const servicesMap = {};
  servicesData.forEach(s => servicesMap[s._id.toHexString()] = s.title);

  const list = q.map(i => {
    const d = new Date(new Date(i.createdAt).toLocaleString(DEFAULT_LOCALE, { timeZone: TIMEZONE }));
    return { 
      id: i._id,
      transactionId: i.transactionId,
      service: { name: servicesMap[i.service.toHexString()] },
      recipient: i.recipient,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      totalAmount: i.totalAmount,
      balanceBefore: i.balanceBefore,
      balanceAfter: i.balanceAfter,
      amount: i.amount,
      status: i.status,
      date: d.toLocaleDateString(),
      time: d.toLocaleTimeString(),
      user: i.user,
      meta: i.meta
    };
  });

  const total = _q[0].count[0]?.total ?? 0;
  res.status(200).json({
    status: 'success',
    msg: 'Transactions listed',
    data: list,
    metadata: {
      page,
      perPage,
      total,
      totalPage: Math.ceil(total / perPage),
      nextPage: (page * perPage < total) ? page + 1 : null
    }
  });
});

exports.getTransaction = catchAsync(async (req, res, next) => {
  const transaction = await Transaction.findById(req.params.id).populate('userId', 'firstName lastName email phone').populate('serviceId', 'title code');
  if (!transaction) return next(new AppError(404, 'Transaction not found'));
  res.status(200).json({ status: 'success', data: transaction });
});

exports.listUsers = catchAsync(async (req, res, next) => {
  const maxPerPage = 50;
  let { page, perPage, search } = req.query;
  page = parseInt(page, 10) || 1;
  perPage = parseInt(perPage, 10) || maxPerPage;

  const filter = {};
  if (search) {
      filter.$or = [
          { email: { $regex: search, $options: 'i' } },
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
      ];
  }

  const users = await User.find(filter, '-password -token')
    .sort({ _id: -1 })
    .skip((page - 1) * perPage)
    .limit(perPage);

  const total = await User.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    data: users,
    metadata: {
      page, perPage, total, totalPage: Math.ceil(total / perPage)
    }
  });
});

exports.getUser = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.id, '-password -token');
  if (!user) return next(new AppError(404, 'User not found'));
  res.status(200).json({ status: 'success', data: user });
});

exports.topupUser = catchAsync(async (req, res, next) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return next(new AppError(400, 'User ID and Amount are required'));

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const service = await Service.findOne({ code: 'wallet-topup' }).session(session);
    if (!service) throw new Error("Wallet topup service not configured");

    const user = await User.findById(userId).session(session);
    const balanceBefore = user.balance;
    const balanceAfter = balanceBefore + Number(amount);

    await User.updateOne({ _id: userId }, { balance: balanceAfter }, { session });

    await Transaction.create([{
      userId,
      transactionId: genRefNo(),
      serviceId: service._id,
      recipient: 'wallet',
      unitPrice: amount,
      quantity: 1,
      amount: amount,
      totalAmount: amount,
      balanceBefore,
      balanceAfter,
      status: TRANSACTION_STATUS.DELIVERED,
      statusDesc: 'Admin Manual Topup',
      meta: { adminId: req.user.id }
    }], { session });

    await session.commitTransaction();
    res.status(200).json({ status: 'success', msg: 'User wallet funded successfully', data: { newBalance: balanceAfter } });
  } catch (error) {
    await session.abortTransaction();
    return next(new AppError(500, 'Topup failed: ' + error.message));
  } finally {
    session.endSession();
  }
});

exports.listServices = catchAsync(async (req, res, next) => {
  const services = await Service.find();
  res.status(200).json({ status: 'success', data: services });
});

exports.updateService = catchAsync(async (req, res, next) => {
  const service = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!service) return next(new AppError(404, 'Service not found'));
  res.status(200).json({ status: 'success', data: service });
});

exports.updateUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  
  // Whitelist fields to prevent unintended document escalations
  const allowedFields = ['commission', 'depositCharge', 'printPaper', 'printColor', 'templates', 'virtualAccounts', 'status', 'role'];
  const updateData = {};
  
  Object.keys(req.body).forEach(key => {
    if (allowedFields.includes(key)) {
      updateData[key] = req.body[key];
    }
  });

  const user = await User.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).select('-password -token');
  if (!user) return next(new AppError(404, 'User not found'));

  res.status(200).json({ status: 'success', data: user, msg: 'User updated successfully' });
});

exports.analytics = catchAsync(async (req, res, next) => {
  let { start, end } = req.query;
  
  let _start = start ? new Date(start) : new Date(new Date().setDate(new Date().getDate() - 30));
  let _end = end ? new Date(end) : new Date();
  
  // Format dates for mongo query
  const filterStart = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(_start);
  const filterEnd = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(_end);

  const filter = [
    {
      $gte: [
        { $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone: TIMEZONE } },
        filterStart
      ]
    },
    {
      $lte: [
        { $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone: TIMEZONE } },
        filterEnd
      ]
    },
    { $eq: [TRANSACTION_STATUS.DELIVERED, '$status'] }
  ];

  const group = { 
    _id: '$date', 
    count: { $sum: 1 }, 
    totalAmount: { $sum: '$totalAmount' },
    totalCommission: { $sum: '$commission' }
  };

  const project = { 
    date: '$_id', 
    count: '$count', 
    transaction: '$totalAmount',
    earning: '$totalCommission'
  };

  const q = await Transaction.aggregate([
    { $match: { $expr: { $and: filter } } },
    {
      $project: {
        totalAmount: 1,
        commission: { $ifNull: ["$commission", 0] },
        date: { $dateToString: { format: "%m/%d/%Y", date: "$createdAt", timezone: TIMEZONE } }
      }
    },
    { $group: group },
    { $project: project },
    { $sort: { date: 1 } }
  ]);

  // Fill in missing dates
  const chartData = [];
  let currentDate = new Date(_start);
  const endDate = new Date(_end);
  
  let totalTransaction = 0;
  let totalEarning = 0;
  let totalCount = 0;

  const dataMap = {};
  for (let item of q) {
      dataMap[item.date] = item;
  }

  while (currentDate <= endDate) {
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDate.getDate()).padStart(2, '0');
    const yyyy = currentDate.getFullYear();
    const aggDateStr = `${mm}/${dd}/${yyyy}`;

    const dayData = dataMap[aggDateStr] || { date: aggDateStr, count: 0, transaction: 0, earning: 0 };
    
    chartData.push(dayData);
    totalTransaction += dayData.transaction;
    totalEarning += dayData.earning;
    totalCount += dayData.count;

    currentDate.setDate(currentDate.getDate() + 1);
  }

  res.status(200).json({ 
    status: 'success', 
    data: { 
      chartData, 
      totalTransaction, 
      totalEarning, 
      totalCount, 
      meta: { start: _start, end: _end } 
    } 
  });
});
