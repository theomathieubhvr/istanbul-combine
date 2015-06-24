var fs = require('fs');
var glob = require('glob');
var Q = require('q');
var readFile = Q.denodeify(fs.readFile);
var Report = require('istanbul').Report;
var Collector = require('istanbul').Collector;

function makeReporterDefs(options) {
  var result = [];
  var reporters = options.reporters &&
  typeof options.reporters === 'object' ? options.reporters : {};
  Object.keys(reporters).forEach(function(reporter) {
    var reporterOpts = reporters[reporter];
    if(reporterOpts) {
      if(options.dir && !reporterOpts.dir) {
        reporterOpts.dir = options.dir;
      }
      result.push({ type : reporter, options : reporterOpts });
    }
  });

  var append = function(t) {
    if(t && !reporters[t]) {
      result.push({type : t, options : options});
      reporters[t] = true;
    }
  };

  append(options.type);

  var mapping = {
    'none' : [],
    'detail': ['text'],
    'both' : ['text', 'text-summary']
  };
  var a = mapping[options.print];
  if(a) {
    a.forEach(append);
  } else {
    append('text-summary');
  }
  return result;
}

function forEachReporter(reporterDefs, cb) {
  reporterDefs.forEach(function(reporterDef){
     cb(Report.create(reporterDef.type, reporterDef.options));
  });
}

function writeCombinedReports(reporterDefs, collector) {
  var writePromises = [];
  forEachReporter(reporterDefs, function(report) {
    var defer = Q.defer();
    writePromises.push(defer.promise);
    report
      .on('done', defer.makeNodeResolver())
      .on('error', defer.makeNodeResolver())
      .writeReport(collector, false);
  });
  return Q.all(writePromises);
}

function writeCombinedReportsSync(reporterDefs, collector) {
  forEachReporter(reporterDefs, function(reporter) {
    reporter.writeReport(collector, true);
  });
}

function collectInputReports(pattern) {
  var realpathCache = Object.create(null);
  var cache = Object.create(null);
  var statCache = Object.create(null);
  var symlinks = Object.create(null);

  var collector = new Collector();
  var fileContentPromises = [];
  var filePaths = Object.create(null);
  var collectorDefer = Q.defer();
  var allPatterns = [];

  if (typeof pattern == 'string') {
    pattern = [pattern];
  }
  for (var i = 0; i < pattern.length; i++) {
    allPatterns.push(makePromiseForPattern(pattern[i]));
  }

  Q.all(allPatterns).then(function(){
    Q.all(fileContentPromises).then(function(){
      collectorDefer.resolve(collector);
    });
  });

  return collectorDefer.promise;

  function makePromiseForPattern(pattern) {
    var patternDefer = Q.defer();
    glob(pattern,
      {
        realpathCache: realpathCache,
        cache: cache,
        statCache: statCache,
        symlinks: symlinks
      })
      .on('match', function(filePath) {
        if(filePaths[filePath]) {
          return;
        }
        filePaths[filePath] = true;
        fileContentPromises.push(readFile(filePath, 'utf-8').then(function(fileContents){
          collector.add(JSON.parse(fileContents));
          return true;
        }));
      })
      .on('error', collectorDefer.reject)
      .on('end', function() {
        patternDefer.resolve(pattern);
      });

    return patternDefer.promise;
  }
}

function collectInputReportsSync(pattern){
  var realpathCache = Object.create(null);
  var cache = Object.create(null);
  var statCache = Object.create(null);
  var symlinks = Object.create(null);
  if ('string' === typeof pattern) {
    pattern = [pattern];
  }
  var collector = new Collector();
  pattern.forEach(function(pattern){
    glob.sync(pattern,{
      realpathCache: realpathCache,
      cache: cache,
      statCache: statCache,
      symlinks: symlinks
    }).forEach(function(file){
      collector.add(JSON.parse(fs.readFileSync(file, 'utf-8')));
    });
  });
  return collector;
}

function normalizeOpts(opts) {
  opts = opts || {};
  if (!opts.dir) opts.dir = 'coverage';
  if (!opts.pattern) opts.pattern = 'coverage/*-coverage.json';
  return opts;
}

function run(opts, done) {
  opts = normalizeOpts(opts);
  var reporters = makeReporterDefs(opts);
  var promise = collectInputReports(opts.pattern).then(
    function(collector) {
      return writeCombinedReports(reporters, collector);
    }
  );
  return Q.nodeify(promise, done);
}

function sync(opts) {
  opts = normalizeOpts(opts);
  var reporters = makeReporterDefs(opts);
  var collector = collectInputReportsSync(opts.pattern);
  writeCombinedReportsSync(reporters, collector);
}

module.exports = run;
module.exports.sync = sync;