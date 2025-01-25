const AppError = require('./AppError');

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(400, message);
};

const handleDuplicateFieldsDB = (err) => {
  console.log('handleDuplicateFieldsDB', err);
  // const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const value = err.keyValue.name;
  // console.log(value);
  const message = `Duplicate field value: ${value}. Please use another value  `;
  return new AppError(400, message);
};

const handleValidationErrorDB = (err) => {
  // res.send(err);
  const errors = Object.values(err.errors).map((el) => el.message);
  // console.log(err);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(400, message);
};

const handleJWTError = (err) => new AppError(401, 'Invalid token. Kindly log in again!');

const handleJWTExpiredError = (err) => new AppError(401, 'Token has expired.');

const sendDevError = (err, res) => {
  console.log(err);
  const json = {
    status: 'error',
    msg: err.message,
    // stack: err.stack,
  };
  if (err?.data)
    json.data = err.data;
  res.status(err.statusCode).json(json);
};

const sendProdError = (err, res) => {
  console.log(err);
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    const json = {
      status: 'error',
      msg: err.message,
      // stack: err.stack,
    };
    if (err?.data)
      json.data = err.data;
    res.status(err.statusCode).json(json);
  } else {
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong',
    });
  }
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendDevError(err, res);
  } else {
    if (err.name === 'CastError') err = handleCastErrorDB(err);
    if (err.code === 11000) err = handleDuplicateFieldsDB(err);
    if (err.name === 'ValidationError') err = handleValidationErrorDB(err);
    if (err.name === 'JsonWebTokenError') err = handleJWTError(err);
    if (err.name === 'TokenExpiredError') err = handleJWTExpiredError(err);

    sendProdError(err, res);
  }
};
