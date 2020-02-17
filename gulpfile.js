"use strict";

require("dotenv").config();

const gulp = require("gulp");

const connect = require("gulp-connect");
const proxy = require("http-proxy-middleware");

const cleancss = require("gulp-clean-css");
const concat = require("gulp-concat");
const yaml = require("gulp-yaml");

const fs = require("fs");
const path = require("path");
const rimraf = require("rimraf");
const readline = require("readline");

var builddir = process.env.BUILD_DIR || __dirname + "/public";
var streams = [];

// init

function createPublicDir() {
  return new Promise(resolve => {
    if (!fs.existsSync(path.resolve(builddir))) {
      fs.mkdirSync(path.resolve(builddir));
      fs.closeSync(fs.openSync(path.resolve(builddir, "blank.js"), "w"));
    }
    resolve();
  });
}

// clean

function removePublicDir() {
  return new Promise(resolve => {
    if (fs.existsSync(path.resolve(builddir))) {
      rimraf(path.resolve(builddir), function(e) {
        if (e) {
          console.log(e);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// serve

async function serveAssets() {
  return connect.server({
    root: __dirname,
    host: process.env.SERVER_HOST || "localhost",
    port: process.env.SERVER_PORT || 3000,
    livereload: true,
    middleware: (req, res) => {
      const proxyServer = proxy(["**", "!/public/**"], {
        target: process.env.TARGET_URL || "http://localhost:3000",
        changeOrigin: true,
        autoRewrite: true,
        protocolRewrite: "http",
        onProxyReq: onProxyReq,
        onProxyRes: onProxyRes
      });

      return [proxyServer];
    }
  });
}

function onProxyRes(proxyRes, req, res) {
  var _write = res.write;
  var _end = res.end;

  var buffer = "";
  res.write = function(data) {
    let body = data.toString("utf-8");
    buffer = buffer + body;
    return _write.call(res, "");
  };

  res.end = function() {
    let output = rewriteContent(buffer);
    _write.call(res, output);
    return _end.call(res);
  };
}

function onProxyReq(proxyReq, req, res) {
  proxyReq.setHeader("accept-encoding", "");
  proxyReq.setHeader("X-Build-Development", "1");
  proxyReq.removeHeader("If-None-Match");
}

function rewriteContent(content) {
  //content = content.replace(/HEAD/, "");
  content = content.replace(
    /\%CLIENTINCLUDES\%/,
    '<link rel="stylesheet" type="text/css" href="/public/variables.css" /><script type="text/javascript">window.traveltek_config_base = "/public"</script>'
  );
  content = rewriteIncludes(content);
  return content;
}

function reload() {
  return new Promise(resolve => {
    gulp.src("public/blank.js").pipe(connect.reload());
    resolve();
  });
}

// display

function compileDisplay() {
  return gulp
    .src("display/*.css")
    .pipe(cleancss())
    .pipe(concat("variables.css"))
    .pipe(gulp.dest(path.resolve(builddir)));
}

function reloadDisplay() {
  return new Promise(resolve => {
    gulp.src("public/variables.css").pipe(connect.reload());
    resolve();
  });
}

function watchDisplay() {
  return new Promise(resolve => {
    streams.push([
      resolve,
      gulp.watch("display/*.css", gulp.series(compileDisplay, reloadDisplay))
    ]);
  });
}

// includes

function compileIncludesCss() {
  return gulp
    .src("includes/*/static/*.css")
    .pipe(cleancss())
    .pipe(gulp.dest(path.resolve(builddir, "includes")));
}

function compileIncludesOther() {
  return gulp
    .src([
      "includes/*/partial.html",
      "includes/*/static/*",
      "!includes/*/static/*.css"
    ])
    .pipe(gulp.dest(path.resolve(builddir, "includes")));
}

function rewriteIncludes(content) {
  var incs = content.match(/\%[A-Z]+\%/g);
  if (incs) {
    for (let inc of incs) {
      let rawInc = inc;
      rawInc = rawInc.replace(/\%/g, "").toLowerCase();
      if (
        fs.existsSync(
          path.resolve(__dirname, "includes", rawInc, "partial.html")
        )
      ) {
        let filecontent = fs
          .readFileSync(
            path.resolve(__dirname, "includes", rawInc, "partial.html")
          )
          .toString();
        filecontent = filecontent.replace(
          /\%STATIC\%/g,
          path.join("/public", "includes", rawInc, "static")
        );
        content = content.replace(inc, filecontent);
      }
    }
  }
  return content;
}

function watchIncludes() {
  return new Promise(resolve => {
    streams.push([
      resolve,
      gulp.watch(
        ["includes/*/partial.html", "includes/*/static/**"],
        gulp.series(exports.includes, reload)
      )
    ]);
  });
}

// locales

function compileLocales() {
  return gulp
    .src("locales/**/*.json")
    .pipe(gulp.dest(path.resolve(builddir, "locales")));
}

function watchLocales() {
  return new Promise(resolve => {
    streams.push([
      resolve,
      gulp.watch("locales/**/*.json", gulp.series(exports.locales, reload))
    ]);
  });
}

// config

function compileConfig() {
  return gulp
    .src(["config/*.yaml", "config/**/*.yaml"])
    .pipe(yaml({ schema: "DEFAULT_SAFE_SCHEMA" }))
    .pipe(gulp.dest(path.resolve(builddir, "config")));
}

function watchConfig() {
  return new Promise(resolve => {
    streams.push([
      resolve,
      gulp.watch(
        ["config/*.yaml", "config/**/*.yaml"],
        gulp.series(exports.config, reload)
      )
    ]);
  });
}

// cli

function handleInput() {
  return new Promise(resolve => {
    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on("close", () => {
      connect.serverClose();
      for (let stream of streams) {
        stream[1].close();
        stream[0]();
      }
      resolve();
    });

    rl.on("SIGINT", () => {
      process.exit(0);
    });

    rl.on("line", line => {
      switch (line.trim()) {
        case "exit":
          rl.close();
          break;
        case "reload":
          gulp.series(exports.build)();
          break;
        default:
          console.warn(`Unrecognised command: ${line.trim()}`);
          break;
      }
    });
  });
}

// exports

exports.init = createPublicDir;
exports.clean = removePublicDir;
exports.display = compileDisplay;
exports.locales = compileLocales;
exports.config = compileConfig;
exports.includes = gulp.parallel(compileIncludesCss, compileIncludesOther);
exports.compile = gulp.parallel(
  exports.display,
  exports.includes,
  exports.locales,
  exports.config
);
exports.serve = gulp.parallel(
  serveAssets,
  handleInput,
  watchDisplay,
  watchIncludes,
  watchLocales,
  watchConfig
);
exports.build = gulp.series(exports.clean, exports.init, exports.compile);
exports.start = gulp.series(exports.build, exports.serve, exports.clean);
exports.default = exports.build;