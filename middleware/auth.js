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
    let token = null;

    if (req?.headers?.authorization && req?.headers?.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req?.session?.token) {
      token = req.session.token;
    }

    if (token) {
      const { payload } = jwt.verify(token, process.env.AUTH_SECRET);
      const q = await User.find({ _id: payload.id }, { _id: 1, token: 1, role: 1 });
      if (q?.length == 1 && payload.token == q[0].token) {
        req.user = { id: q[0]._id.toHexString(), role: q[0].role };
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

exports.isAdmin = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user && req.user.role === ROLES.ADMIN) {
      next();
    } else {
      return next(new AppError(403, 'Admin access denied'));
    }
  });
};