const jwt = require('jsonwebtoken');

const AppError = require('../helpers/AppError');
const catchAsync = require('../helpers/catchAsync');
const { isLive } = require('../helpers/utils');
const User = require('../models/user');
const { ROLES } = require('../helpers/consts');

class Auth {
  secret = process.env.AUTH_SECRET;

  constructor(secret) {
    if (secret) {
      this.secret = secret;
    }
  };

  auth = catchAsync(async (req, res, next) => {
    if (req?.headers?.authorization && req?.headers?.authorization.startsWith('Bearer')) {
      const token = req.headers.authorization.split(' ')[1];
      req.account = { token };
    }

    if (req?.session?.token) {
      req.user = jwt.verify(req.session.token, this.secret).payload;
    }

    if (req?.account?.token) {
      const { payload } = jwt.verify(req?.account?.token, process.env.AUTH_SECRET);
      const q = await User.find({ _id: payload.id }, { _id: 1, token: 1 });
      if (q?.length == 1 && payload.token == q[0].token) {
        req.user = { ...req?.user, id: q[0]._id.toHexString() };
      }
    }

    next();
  });
}

exports.auth = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user) {
      next();
    } else {
      return next(new AppError(401, 'Access denied'));
    }
  });
};