'use strict';

/**
 * Main PhantomJS Runner
 * See https://github.com/ariya/phantomjs/wiki/API-Reference
 *
 * As this process is spawned by node, a non-zero exit code is assumed to be
 * an error, at which point anything written to STDERR will be treated as the
 * error message.
 */

var system  = require('system');

/**
 * Main error handler, if not specified PhantomJS will simply freeze
 */
phantom.onError = function(msg, trace){
  var output = [msg];
  if (trace && trace.length) {
    trace.forEach(function(t){
      output.push([
        '  ',
        t.file || t.sourceURL,
        ':' + t.line,
        t.function ? '(in function ' + t.function + ')' : ''
      ].join(''));
    });
  }
  system.stderr.write(output.join('\n') + '\n');
  phantom.exit(1);
};

var webpage = require('webpage');
var page    = webpage.create();

/**
 * This will be called if any resource on the page cannot be loaded. To avoid
 * potential inconsistencies, the process exits if one of these is encountered.
 */
page.onResourceError = function(err){
  system.stderr.writeLine('Could not load resource');
  system.stderr.writeLine('  Code: ' + err.errorCode);
  system.stderr.writeLine('  Description: ' + err.errorString);
  phantom.exit(1);
};