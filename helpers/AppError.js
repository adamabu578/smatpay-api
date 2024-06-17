class AppError extends Error {
    constructor(statusCode, message, data) {
      // calling the error
      super(message);
      this.statusCode = statusCode;
      // this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
      this.isOperational = true;
      this.data = data ?? null;
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  module.exports = AppError;