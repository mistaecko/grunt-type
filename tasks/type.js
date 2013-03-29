/*
 * grunt-contrib-coffee
 * http://gruntjs.com/
 *
 * Copyright (c) 2012 Álvaro Vilanova Vidal
 * Licensed under the MIT license.
 */

module.exports = function(grunt) {
  'use strict';

  var fs = require('fs');
  var os = require('os');
  var path = require('path');
  var helpers = require('grunt-lib-contrib').init(grunt);

  // TODO: ditch this when grunt v0.4 is released
  grunt.util = grunt.util || grunt.utils;

  var withTscCommand = function (cmdpath, cb) {
    cmdpath = cmdpath || 'tsc';
      var cmd = parseCmd(cmdpath);
      cmd.args = cmd.args.concat('--version');
    cb(cmdpath);

      // check for a working tsc configuration
//    grunt.util.spawn(cmd, function (error) {
//      if (error) {
//        grunt.fatal((error.message ? error.message + '. ' : '') + cmd + ' cannot be run. Try ' + 'npm install -g typescript'.cyan);
//      }
//      else {
//        cb(cmdpath);
//      }
//    });
  };

  /**
   * Split the given command path into executable and arguments
   * @param cmdpath
   * @returns {Object} a command object holding the path to the executable (as string) and an args (as array)
   */
  var parseCmd = function(cmdpath) {
    var cmd = cmdpath.split(' ');
    cmd = {
      cmd: cmd.shift(),
      args: cmd
    }
    return cmd;
  };

  var cmdToString = function (cmd) {
    var args = grunt.util._.reduce(cmd.args, function (m, s) { return m + ' ' + s; }, '');
    return cmd.cmd + args;
  };

  var isAmbientFile = function (filepath) {
    var ends = grunt.util._.endsWith;
    return ends(filepath, '.d.ts') || ends(filepath, '.d.js');
  };

  var isDirTarget = function (trgpath) {
    return grunt.util._.last(trgpath) === path.sep;
  };

  var isMultiTarget = function (trgpath) {
    var paths = grunt.file.expand(trgpath);
    if (paths.length > 1) {
      return true;
    }
    else {
      var p = (paths.length === 1) ? paths[0] : trgpath;
      return grunt.util._.str.include(p, '*') || isDirTarget(p);
    }
  };

  // TODO: Use _.omit when grunt 0.4 is released
  var removeInvalidOpts = function (options) {
    var copy = {};
    var keys = ['tsc', 'basePath', 'flatten', 'out', 'exec'];
    for (var key in options) {
      if (!grunt.util._.contains(keys, key)) {
        copy[key] = options[key];
      }
    }
    return copy;
  };

  var compile = function (tscpath, srcs, trg, options, cb) {
    // always use manyToOne since we use one file as entry point that compiles to a different name
    // todo - look into that
    compileManyToOne(tscpath, srcs, trg, options, cb);
  };

  var tmpPath = function (filepath) {
    var rndstr = (Math.floor(Math.random() * 1000000)).toString();
    var name = rndstr + path.basename(filepath);
    return path.join(os.tmpDir(), name);
  };

  var jsPath = function (filepath) {
    return path.join(path.dirname(filepath),
                     path.basename(filepath, path.extname(filepath)) + ".js");
  };

  var optsToTscArgs = function (options) {
    options = removeInvalidOpts(options);

    if (options.reference) {
      var files = grunt.file.expandFiles(options.reference);
      options.reference = files;
    }

    return helpers.optsToArgs(options);
  };

  var checkCompilerOutput = function (trg, error, result, success) {
    if (error) {
      grunt.warn(error);
//      grunt.warn(result.stdout);
//      grunt.warn(result.stderr);
    }
    else {
      //grunt.log.write(trg + "...");
      grunt.log.ok();
      if (grunt.util._.isFunction(success)) {
        success();
      }
    }
  };

  var compileOneToOne = function (tscpath, src, trg, options, cb) {
    var cmd = parseCmd(tscpath);
    cmd.args = cmd.args.concat(src);
    cmd.args.push.apply(cmd.args, optsToTscArgs(options));
    grunt.verbose.writeln(cmdToString(cmd));

    var backupPath = '';
    var srcpath = jsPath(src);
    if (fs.existsSync(srcpath)) {
      backupPath = tmpPath(srcpath);
      grunt.file.copy(srcpath, backupPath);
    }

    grunt.util.spawn(cmd, function (error, result) {
      checkCompilerOutput(trg, error, result, function () {
        grunt.file.copy(srcpath, trg);
        fs.unlinkSync(srcpath);
      });
      if (backupPath.length > 0) {
        grunt.file.copy(backupPath, srcpath);
      }
      cb();
    });
  };

  var compileManyToOne = function (tscpath, srcs, trg, options, cb) {
    var cmd = parseCmd(tscpath);
    cmd.args = cmd.args.concat('--out', trg);
    cmd.args.push.apply(cmd.args, srcs);
    cmd.args.push.apply(cmd.args, optsToTscArgs(options));
    grunt.verbose.writeln(cmdToString(cmd));
    grunt.log.write('Compiling to "' + trg + '"...');

    var child = grunt.util.spawn(cmd, function (error, result) {
      checkCompilerOutput(trg, error, result);
      cb();
    });

    if (child.stdout) {
      child.stdout.on('data', function(buf) {
        grunt.verbose.write(buf.toString('ascii'));
      });
    }
    if (child.stderr) {
      var hasErrors = false;
      child.stderr.on('data', function(buf) {
        if(!hasErrors) {
          grunt.log.error();
          grunt.log.writeln('Note: The compilation process is still running.');
        }
        hasErrors = true;
        grunt.log.write(buf.toString('ascii'));
      });
    }
  };

  grunt.registerMultiTask('type', 'Compile TypeScript files to JavaScript', function() {
    var done = this.async();

    var options = helpers.options(this, {
      basePath          : '',
      comments          : false,
      const             : false,
      //declarations      : false,
      flatten           : false,
      minw              : false,
      module            : 'commonjs',
      noerroronwith     : false,
      nolib             : false,
      nooptimizemodules : false,
      noresolve         : false,
      //reference         : false,
      //sourcemap         : false,
      style             : false,
      target            : 'ES3',
      tsc               : ''
    });
    grunt.verbose.writeflags(options, 'Options');

    // TODO: ditch this when grunt v0.4 is released
    this.files = this.files || helpers.normalizeMultiTaskFiles(this.data, this.target);

    // Compute compiler pases
    var files = grunt.util._.map(this.files, function (file) {
      var dest = path.normalize(file.dest);
      // was: expandFiles (grunt 0.3?)
      var srcs = grunt.file.expand(file.src);
      if (isMultiTarget(dest)) {
        var basePath = helpers.findBasePath(srcs, options.basePath);
        return grunt.util._.map(srcs, function (src) {
          var trg = helpers.buildIndividualDest(dest, src, basePath, options.flatten);
          if (isDirTarget(dest)) {
            trg = path.join(dest, trg);
          }
          grunt.file.mkdir(path.dirname(trg));
          return {dest: trg, src: [src]};
        });
      }
      else {
        return {dest: dest, src: srcs};
      }
    });

    // Normalize pases
    files = grunt.util._.compact(grunt.util._.flatten(files));

    // Ignore ambient compilation pases
    files = grunt.util._.reject(files, function (file) {
      return isAmbientFile(file.dest);
    });

    // Execute pases in parallel
    var almostDone = grunt.util._.after(files.length, done);
    withTscCommand(options.tsc, function (tsc) {
      grunt.util.async.forEachLimit(files, os.cpus().length, function (file, finish) {
        grunt.file.mkdir(path.dirname(file.dest));
        compile(tsc, file.src, file.dest, options, function () {
          finish();
          almostDone();
        });
      });
    });
  });
};

