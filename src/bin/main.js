#!/usr/bin/env node

require("dotenv").config();
require("@babel/register")({
  plugins: [["@babel/plugin-transform-react-jsx"]],
  ignore: [/node_modules/],
});
const Koa = require("koa");
const serve = require("koa-static");
const logger = require("koa-logger");
const { resolve, join } = require("path");
const response = require("../response");
const { MongoClient, ObjectId } = require("mongodb");
const session = require("koa-session");
const bodyparser = require("koa-bodyparser");
const ejs = require("ejs");
const { readdir, stat } = require("fs/promises");
const elements = require("../elements");
const Router = require("koa-router");
const { renderToStaticMarkup } = require("react-dom/server");
const reactIs = require("react-is");
const mapAsync = (array, func) => Promise.all(array.map(func));

const publicDir = process.env.PUBLIC_DIR || "./public";

const locals = async ctx => {
  return {
    redirect: path => {
      throw new response.Redirect(path);
    },
    response,
    ctx,
    elements,
  };
};

const ejsHandler = filePath => async ctx => {
  ctx.set("Content-Type", "text/html");
  const options = { root: resolve(publicDir), async: true };
  const l = await locals(ctx);
  const html = await ejs.renderFile(filePath, l, options);
  ctx.body = html;
};

const registerFile = async (dir, file, router) => {
  let [path, extension] = file.split(/\.(?=[^.]+$)/);
  path = path === "index" ? "/" : `/${path}`;
  const filePath = join(dir, file);
  if (extension === "ejs") router.all(path, ejsHandler(filePath));
  else if (extension === "jsx") {
    const module = require(resolve(filePath));
    const subRouter = new Router({ prefix: `${path}` });
    if (module.get) subRouter.get("/", module.get);
    if (module.post) subRouter.post("/", module.post);
    if (module.put) subRouter.put("/", module.put);
    if (module.patch) subRouter.patch("/", module.patch);
    if (module.delete) subRouter.delete("/", module.delete);
    if (module.all) subRouter.all("/", module.all);

    router.use(subRouter.routes());
  }
};

const registerDir = async (dir, router) => {
  const isHidden = fn => fn.startsWith(".") || fn.startsWith("_");
  const files = (await readdir(dir)).filter(fn => !isHidden(fn));
  await mapAsync(files, async file => {
    if (file.startsWith("_") || file.startsWith(".")) return;
    if ((await stat(join(dir, file))).isDirectory()) {
      const subRouter = new Router({ prefix: `/${file}` });
      await registerDir(join(dir, file), subRouter);
      router.use(subRouter.routes());
    }
    await registerFile(dir, file, router);
  });
};

async function main() {
  const mongo =
    process.env.MONGODB_URI && new MongoClient(process.env.MONGODB_URI);
  if (mongo) await mongo.connect();
  const mongodb = mongo && mongo.db();

  const app = new Koa();
  app.use((ctx, next) => {
    ctx.mongodb = mongodb;
    return next();
  });

  const key =
    "FNLR9WBXnqojIt6I/kMXg9KU0mTKLH6MUuaL++bEYXVnSECuUkEfNUskUpctGCUQ9kK5QbD56zXZs70fuY0U+Q==";
  app.keys = [key];
  const imgExtensions = ["jpeg", "jpg", "svg", "png", "webp", "ico"];
  const extensions = ["js", "css", "html", ...imgExtensions];
  app.use(serve(publicDir, { extensions }));
  app.use(logger());
  app.use(bodyparser());
  app.use(response.middleware);
  app.use(session({ db: mongodb, expirationTime: 60 * 60 * 24 * 7 }, app));
  if (mongodb)
    app.use(async (ctx, next) => {
      ctx.user =
        (ctx.session.uid &&
          (await ctx.mongodb
            .collection("users")
            .findOne({ _id: new ObjectId(ctx.session.uid) }))) ||
        undefined;
      await next();
      if (ctx.user) ctx.session.uid = ctx.user._id;
    });

  const router = new Router();
  router.use(async (ctx, next) => {
    await next();
    if (reactIs.isElement(ctx.body)) {
      ctx.set("Content-Type", "text/html");
      ctx.body = "<!DOCTYPE html>" + renderToStaticMarkup(ctx.body);
    }
  });
  await registerDir(publicDir, router);
  router.get("/help", ctx => (ctx.body = "body"));

  app.use(router.routes(), router.allowedMethods());

  const port = Number.parseInt(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`listening on http://localhost:${port}/`);
}

main().catch(console.error);
