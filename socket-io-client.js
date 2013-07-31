'use strict';

module.exports = SocketIOClient;

var util      = require('util');
var events    = require('events');
var WebSocket = require('ws');
var request   = require('request');
var URI       = require('URIjs');
var async     = require('async');
var _         = require('underscore');
var debug     = require('debug')('socket-io-client');

function SocketIOClient(baseUrl, cookies){
  events.EventEmitter.call(this);
  this.baseUri   = new URI(baseUrl);
  this.cookies   = cookies;
  this.namespace = this.baseUri.path();
  this.version   = 1;
  this.connected = false;
  this.init();
};

util.inherits(SocketIOClient, events.EventEmitter);

SocketIOClient.prototype.init = function(){
  this.setupQueue();
  this.handshake();
  this.once('handshakeComplete', this.connect.bind(this));
};

SocketIOClient.prototype.setupQueue = function(){
  this.queue = async.queue(function(job, callback){
    var args = job.args.slice();
    args.push(callback);
    debug('> Sending to socket');
    debug(args[0]);
    this.socket.send.apply(this.socket, args);
  }.bind(this), 1);
};

SocketIOClient.prototype.handshareUrl = function(){
  return this.baseUri.clone()
    .segment(['socket.io', this.version])
    .toString();
};

SocketIOClient.prototype.handshake = function(){
  debug('> Handshake');
  request({
    url: this.handshareUrl(),
    method: 'GET',
    jar: this.cookies
  }, function(err, response){
    debug('> Handshake response');
    debug(response.body);
    if (err) this.emit('error', err);
    var configs = response.body.split(':');
    this.socketToken = configs[0];
    this.heartbeatInterval = parseInt(configs[1], 10) * 1000;
    this.emit('handshakeComplete');
  }.bind(this));
};

SocketIOClient.prototype.socketUrl = function(){
  return this.baseUri.clone()
    .segment(['socket.io', this.version, 'websocket', this.socketToken])
    .toString();
};

SocketIOClient.prototype.connect = function(){
  debug('> Connecting to socket');

  this.socket = new WebSocket(this.socketUrl());

  this.socket.on('open', function(){
    debug('> Socket connected');

    this.once('connectionInitiated', function(){
      if (!this.namespace) return this.emit('connect');
      this.send('1::' + this.namespace);
    }.bind(this));

    this.startHeartbeat();
  }.bind(this));

  this.socket.on('message', this.handleMessage.bind(this));
};

SocketIOClient.prototype.send = function(message, callback){
  this.queue.push({args: [message]}, callback);
};

SocketIOClient.prototype.startHeartbeat = function(){
  debug('> Starting heartbeat');

  if (this.heartbeat) this.stopHeartbeat();

  this.heartbeat = setInterval(function(){
    if (this.socket.readyState !== WebSocket.OPEN) return this.stopHeartbeat();
    debug('> Queuing heartbeat');
    this.send('2::');
  }.bind(this), this.heartbeatInterval);
};

SocketIOClient.prototype.stopHeartbeat = function(){
  return clearInterval(this.heartbeat);
};

var MESSAGE_TYPES = Object.freeze({
  '0': 'disconnect',
  '1': 'connect',
  '2': 'heartbeat',
  '3': 'message',
  '4': 'jsonMessage',
  '5': 'event',
  '6': 'ack',
  '7': 'error',
  '8': 'noop'
});

var MESSAGE_CODES = _.invert(MESSAGE_TYPES);

SocketIOClient.prototype.handleMessage = function(data, flags){
  var match = data.match(/^([0-8]):([^:]*):([^:]*)(?::(.*))?$/);
  var message = {
    type: MESSAGE_TYPES[match[1]],
    id: match[2] || null,
    enpoint: match[3],
    data: match[4] ? JSON.parse(match[4]) : null
  };

  debug('> Received message');
  debug(JSON.stringify(message));

  switch (message.type) {
    case 'error':
      var errorMessage = 'Encountered Socket.IO Error\n' + JSON.stringify(message);
      this.emit('error', new Error(errorMessage));
      break;
    case 'connect':
      if (this.connected) {
        this.emit('connect');
      } else {
        this.connected = true;
        this.emit('connectionInitiated');
      }
      break;
    default:
      this.emit(message.type, message);
  }
};

SocketIOClient.prototype.sendEvent = function(){
  var args = _.toArray(arguments);
  var name = args.shift();
  var message = [
    '5',
    null,
    this.namespace,
    JSON.stringify({name: name, args: args})
  ].join(':');
  this.send(message);
};