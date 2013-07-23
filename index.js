'use strict';

module.exports = HallClient;

var inherits = require('util').inherits;
var Emitter  = require('events').EventEmitter;
var spawn    = require('child_process').spawn;
var path     = require('path');
var binPath  = require('phantomjs').path;

function HallClient(username, password){
  if (!username || !password) throw new Error('Please provide both username and password');
  this.username = username;
  this.password = password;
  Emitter.call(this);
  this.init();
}

inherits(HallClient, Emitter);

HallClient.prototype.init = function(){
  var args = [path.resolve(__dirname, './runner.js')];
  this.errorLog = '';
  this.process = spawn(binPath, args);
  this.process.on('close', this.handleClose.bind(this));
  this.process.stderr.on('data', this.handleStderr.bind(this));
};

HallClient.prototype.handleClose = function(code){
  if (code === 0) return;
  var message = 'PhantomJS process exited with code ' + code + '\n';
  message += this.errorLog;
  this.emit('error', new Error(message));
};

HallClient.prototype.handleStderr = function(data){
  this.errorLog += data.toString();
};