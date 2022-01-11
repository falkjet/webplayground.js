const ejs = require("ejs");

class Response {}

class Redirect extends Response {
  code = 302;
  constructor(url) {
    super();
    this.url = url;
  }
  respond(ctx) {
    ctx.redirect(this.url);
  }
}

class ErrorResponse extends Response {
  constructor(message) {
    super();
    this.message = message;
  }
  respond(ctx) {
    ctx.code = this.code;
    ctx.body =
      process.env.NODE_ENV === "development" ? this.message : this.codeName;
  }
}

class BadRequest extends ErrorResponse {
  code = 400;
  codeName = "Bad Request";
}
class InternalError extends ErrorResponse {
  code = 500;
  codeName = "Internal Error";
}
class Ok extends Response {
  code = 200;
  respond(ctx) {
    ctx.code = this.code;
  }
}

const middleware = async (ctx, next) => {
  try {
    await next();
  } catch (e) {
    const res =
      e instanceof Response
        ? e
        : new InternalError(
            String(ejs.render("<%= value %>", { value: String(e) }))
          );
    res.respond(ctx);
  }
};

module.exports = {
  Redirect,
  BadRequest,
  InternalError,
  Ok,
  middleware,
};
