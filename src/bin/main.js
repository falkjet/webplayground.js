#!/usr/bin/env node

require("dotenv").config();
require("@babel/register")({
  plugins: [["@babel/plugin-transform-react-jsx"]],
  ignore: [/node_modules/],
});
const Koa = require("koa");
const logger = require("koa-logger");
const { resolve, join } = require("path");
const response = require("../response");
const { MongoClient, ObjectId } = require("mongodb");
const session = require("koa-session");
const bodyparser = require("koa-bodyparser");
const ejs = require("ejs");
const { readdir, stat, readFile } = require("fs/promises");
const elements = require("../elements");
const Router = require("koa-router");
const { renderToStaticMarkup } = require("react-dom/server");
const reactIs = require("react-is");
const mapAsync = (array, func) => Promise.all(array.map(func));

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

const connectToMongoDB = async mongoURI => {
  const mongoClient = mongoURI && new MongoClient(mongoURI);
  if (mongoClient) await mongoClient.connect();
  return mongoClient && mongoClient.db();
}

const reactMiddleware = async (ctx, next) => {
  await next();
  if (reactIs.isElement(ctx.body)) {
    ctx.set("Content-Type", "text/html");
    ctx.body = "<!DOCTYPE html>" + renderToStaticMarkup(ctx.body);
  }
}

const createApp = async ({ publicDir, mongoURI, keys }) => {

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

    const imgExtensions = ["jpeg", "jpg", "svg", "png", "webp", "ico"];
    const extensions = ["js", "mjs", "cjs", "css", "html", ...imgExtensions];
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
    } else if (extensions.includes(extension)) {
      router.get(file, async ctx => {
        ctx.body = await readFile(file)
      })
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

  const mongodb = await connectToMongoDB(mongoURI)

  const app = new Koa();
  app.use((ctx, next) => {
    ctx.mongodb = mongodb;
    return next();
  });

  if (Array.isArray(keys)) app.keys = keys;
  else app.keys = [keys];
  app.use(logger());
  app.use(bodyparser());
  app.use(response.middleware);
  if (mongodb) {
    app.use(session({ db: mongodb, expirationTime: 60 * 60 * 24 * 7 }, app));
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
  }

  const router = new Router();
  router.use(reactMiddleware);
  await registerDir(publicDir, router);
  app.use(router.routes(), router.allowedMethods());

  return app;
};

async function main() {
  const app = await createApp({
    publicDir: process.env.PUBLIC_DIR || "./public",
    mongoURI: process.env.MONGODB_URI,
    keys: process.env.KEYS.split(":"),
  });
  const port = Number.parseInt(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`listening on http://localhost:${port}/`);
}

main().catch(console.error);
