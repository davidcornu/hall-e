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
  this.room         = null;
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
      'user[email]':        this.username,
      'user[password]':     this.password
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
  return _.chain({
    uuid: /uuid\s*:\s*'([^']+)'/,
    name: /"display_name"\s*:\s*"([^"]+)"/,
    id:   /"_id"\s*:\s*"([^"]+)"/
  }).map(function(rxp, attr){
    return [attr, str.match(rxp)[1]];
  }).object().value();
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
    this.userInfo     = extractUserInfo(configScripts);
    return callback();
  }.bind(this));
};

HallClient.prototype.getRooms = function(callback){
  debug('> Getting list of rooms');
  request({
    url:  'https://hall.com/api/1/rooms/groups',
    jar:  this.cookies,
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
    if (message.data.name !== 'ROOM_ITEM_NEW') return;
    var parsedMessage = JSON.parse(message.data.args[0]);
    if (parsedMessage.agent._id === this.userInfo.id) return;
    this.emit('message', parsedMessage);
  }.bind(this));

  this.client.once('connect', function(){
    debug('> Client connected');
    this.emit('connect');
  }.bind(this));
};

HallClient.prototype.joinRoom = function(roomId){
  debug('> Joining room');
  this.room = _.find(this.rooms, function(r){ return r._id === roomId; });
  this.client.sendEvent('join room', {
    uuid: roomId,
      member: {
        name:           this.userInfo.name,
        id:             this.userInfo.id,
        hall_member_id: null,
        hall_uuid:      null,
        photo_url:      "",
        mobile:         false,
        native:         false,
        admin:          false
      },
    member_uuid: this.userInfo.uuid
  });
};

HallClient.prototype.postMessage = function(message, callback){
  var originId = (Math.random()*11 + '').replace('.','');
  request({
    method: 'POST',
    jar: this.cookies,
    url: 'https://hall.com/api/1/rooms/groups/' + this.room._id + '/room_items',
    headers: { 'x-csrf-token': this.csrfToken },
    json: {
      "rendered": false,
      "nested": true,
      "time_threshold_reached": false,
      "first_of_day": false,
      "current_user": true,
      "contains_code": false,
      "allow_html": false,
      "agent": {
        "admin": false,
        "is_me": false,
        "loading": false,
        "invitable": true,
        "photo_url": null,
        "display_name": this.userInfo.name,
        "friendship": null,
        "connected": false,
        "connectivity_on": 0,
        "global": false,
        "guided": false,
        "last_friendship": null,
        "user_status": {
          "message": null,
          "status": null
        },
        "_id": this.userInfo.id
      },
      "type": "Comment",
      "message": {
        "html": message,
        "plain": message
      },
      "mentions": message,
      "item_origin_id": originId,
      "room_id": this.room._id,
      "room_title": this.room.title,
      "is_attachment": false,
      "is_notepad": false,
      "is_meeting": false,
      "is_service_hook": false,
      "origin_id": originId
    }
  }, function(err, response){
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(new Error('Could not post message'));
    callback(null, response.body);
  });
};