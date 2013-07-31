'use strict';

// avoids UNABLE_TO_VERIFY_LEAF_SIGNATURE
require('https').globalAgent.options.rejectUnauthorized = false;

var request        = require('request');
var cheerio        = require('cheerio');
var _              = require('underscore');
var crypto         = require('crypto');
var URI            = require('URIjs');
var async          = require('async');
var util           = require('util');
var events         = require('events');
var debug          = require('debug')('hall-client');

var SocketIOClient = require('./socket-io-client');

function HallClient(username, password){
  events.EventEmitter.call(this);
  this.username     = username;
  this.password     = password;
  this.cookies      = request.jar();
  this.csrfToken    = null;
  this.streamConfig = null;
  this.userInfo     = null;
  this.rooms        = null;
  this.client       = null;
  this.init();
};

util.inherits(HallClient, events.EventEmitter);

HallClient.prototype.init = function(){
  async.series([
    this.getCsrfToken.bind(this),
    this.login.bind(this),
    this.getConfig.bind(this),
    this.getRooms.bind(this),
    this.connect.bind(this)
  ], function(err){
    if (err) return this.emit('error', err);
  }.bind(this));
};

HallClient.prototype.getCsrfToken = function(callback){
  debug('> Getting CSRF token');
  request({
    url: 'https://hall.com/users/sign_in',
    jar: this.cookies
  }, function(err, response){
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(new Error('Could not get csrf token'));
    var $ = cheerio.load(response.body);
    this.csrfToken = $('input[name="authenticity_token"]').val();
    if (!this.csrfToken) return callback(new Error('Could not get csrf token'));
    callback();
  }.bind(this));
};

HallClient.prototype.login = function(callback){
  debug('> Logging in');
  request({
    method: 'POST',
    url: 'https://hall.com/users/sign_in',
    jar: this.cookies,
    form: {
      'authenticity_token': this.csrfToken,
      'user[email]': this.username,
      'user[password]': this.password
    }
  }, function(err, response){
    if (err) return callback(err);
    if (response.statusCode !== 302) return callback(new Error('Could not log in'));
    callback();
  });
};

function extractStreamConfig(str){
  var blockRxp = /Stream\s*:\s*{((?:\s*\w+\s*:\s*"[^"]*",?)+)\s*}/gm;
  var itemRxp  = /\s*(\w+)\s*:\s*"([^"]*)",?/gm;

  if (!blockRxp.test(str)) return null;

  var block = str.match(blockRxp)[0];
  var match, config = {};

  while (match = itemRxp.exec(block)) { config[match[1]] = match[2]; }

  return config;
}

function extractUserInfo(str){
  var uuidRxp = /uuid\s*:\s*'([^']+)'/m;
  if (!uuidRxp.test(str)) return null;
  return { uuid: uuidRxp.exec(str)[1] };
}

HallClient.prototype.getConfig = function(callback){
  debug('> Getting config');
  request({
    url: 'https://hall.com/home',
    jar: this.cookies
  }, function(err, response){
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(new Error('Could not get config'));
    var $ = cheerio.load(response.body);
    var configScripts = $('script:not([src])')
      .map(function(index, el){
        return $(el).text();
      }).filter(function(src){
        if (src.indexOf('CL.Cfg') >= 0) return true;
        if (src.indexOf('CL.M.CurrentUserBoot') >= 0) return true;
        return false;
      }).join('\n');

    this.streamConfig = extractStreamConfig(configScripts);
    this.userInfo = extractUserInfo(configScripts);
    return callback();
  }.bind(this));
};

HallClient.prototype.getRooms = function(callback){
  debug('> Getting list of rooms');
  request({
    url: 'https://hall.com/api/1/rooms/groups',
    jar: this.cookies,
    json: true
  }, function(err, response){
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(new Error('Could not get rooms'));
    this.rooms = response.body;
    debug(JSON.stringify(this.rooms));
    callback();
  }.bind(this));
};

HallClient.prototype.socketIOUrl = function(){
  var md5 = crypto.createHash('md5');
  md5.update(this.userInfo.uuid + this.csrfToken);
  return (new URI('https://' + this.streamConfig.host))
    .query({id: this.userInfo.uuid, session: md5.digest('hex')})
    .path('/room')
    .toString();
};

HallClient.prototype.connect = function(callback){
  debug('> Initializing client');
  this.client = new SocketIOClient(this.socketIOUrl(), this.cookies);

  this.client.on('event', function(message){
    console.log('Received:', message);
  });

  this.client.once('connect', function(){
    debug('> Client connected');
    debug('> Joining room');
    this.client.sendEvent('join room', {
      "uuid": "37f20834df",
        "member": {
          "name": "David Cornu",
          "id": "1449610",
          "hall_member_id": null,
          "hall_uuid": null,
          "photo_url": "",
          "mobile": false,
          "native": false,
          "admin": false
        },
      "member_uuid": "2d371a6959311f7ea179d75f6d6e5359"
    });
  }.bind(this));
};

var client = new HallClient('davidjcornu@gmail.com', 'testing');