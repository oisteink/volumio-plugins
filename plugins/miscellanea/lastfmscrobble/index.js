'use strict';

var libQ = require('kew');
var fs=require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

var io = require('socket.io-client');
var lastfmNodeClient = require('./lastfm-node-client');

module.exports = lastfmscrobble;
function lastfmscrobble(context) {
	var self = this; //What's with all the unused self = this declarations??

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

lastfmscrobble.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))(); //There was an unused variable for this at the top but this is the only reference to v-conf so i deleted it
	this.config.loadFile(configFile);
    return libQ.resolve();
}

lastfmscrobble.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();

	this.previousState = {status: '', title: '', artist: '', album: ''}; //better would be to use getEmptyState from CoreStateMachine
	this.scrobbleTimeoutHandle = 0;
	//what if we don't have any login info? probably we dont send a resolve?

	//this.lastfm = new lastfmNodeClient(API_key, Shared_secret, session_key);
	this.setupLastFM();
	this.socket = io.connect('http://localhost:3000');
	this.socket.on('pushState', this.stateHandler.bind(this));

	// Once the Plugin has successfull started resolve the promise
	defer.resolve();

    return defer.promise;
};

lastfmscrobble.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();

    return libQ.resolve();
};

lastfmscrobble.prototype.onRestart = function() {
    var self = this;
    // Optional, use if you need it
};

// lastfmscrobble Methods -----------------------------------------------------------------------------

lastfmscrobble.prototype.log = function(string) {
	this.commandRouter.pushConsoleMessage('[lastfmscrobble] ' + string);
}

lastfmscrobble.prototype.scrobbleTimeoutHandler = function() {
	this.lastfm.trackScrobble(this.scrobbleData)
	.then(this.lfmScrobbleOkcb.bind(this))
	.catch(this.lfmFailcb.bind(this))
}

lastfmscrobble.prototype.stopTimers = function() {
	if (this.scrobbleTimeoutHandle) {
		clearTimeout(this.scrobbleTimeoutHandle);
		this.scrobbleTimeoutHandle = 0;
	}
}
/*
 {
	"scrobbles":{
		"@attr":{
				"accepted":1,
			"ignored":0
			},
		"scrobble":{
			"artist":{
				"corrected":"0",
				"#text":"Transglobal Underground"
			},
			"ignoredMessage":{
				"code":"0",
				"#text":""
			},
			"albumArtist":{
				"corrected":"0",
				"#text":""
			},
			"timestamp":"1581632525",
			"album":{
				"corrected":"0",
				"#text":"International Times"
			},
			"track":{
				"corrected":"0","#text":"Lookee Here"
			}
		}
	}
}
*/

lastfmscrobble.prototype.lfmScrobbleOkcb = function(data) {
	this.log(JSON.stringify(data));
	this.commandRouter.pushToastMessage('success', "last.fm scrobble", "Scrobbled "+data.scrobbles.scrobble.artist['#text'] + ' - ' + data.scrobbles.scrobble.track['#text']);
	/*for (var [key, value] of Object.entries(data.scrobbles.scrobble.artist)) {
		this.log(key+':'+value);
		}
	//this.log(data.scrobbles.scrobble.artist[1]);*/
	//this.log(data.scrobbles.scrobble.artist['#text']); //NAI!! VI måsta finne den!!! 
//	this.log(Object.getOwnPropertyNames(Array(data.scrobbles.scrobble.track)));
}

lastfmscrobble.prototype.lfmOkcb = function(data) {
	//this.commandRouter.pushToastMessage('success', "last.fm scrobble", "Scrobbled "+data.scrobbles.scrobble.artist + ' - ' + data.scrobbles.scrobble.track.#text);
	this.log(JSON.stringify(data));
}

lastfmscrobble.prototype.lfmFailcb = function(err) {
	//we probably want to toast here - as there might be something the user can solve
	this.log(JSON.stringify(err));
}

lastfmscrobble.prototype.lfmNowPlaying = function(state) {
	if (state.stream === true) { //handle webradio - split artist into album and artist - album is empty 
		var artistalbum = state.title.split(' - ');
		if (artistalbum.length == 2) {
			this.lastfm.trackUpdateNowPlaying({artist: artistalbum[0], track: artistalbum[1]})
		}
	} else {
		this.lastfm.trackUpdateNowPlaying({artist: state.artist, track: state.title})
		.then(this.lfmOkcb.bind(this))
		.catch(this.lfmFailcb.bind(this));
	}
}

lastfmscrobble.prototype.SetuplfmScrobble = function(state) {
	if (state.duration > 30) { 										//The track must be longer than 30 seconds.
		this.scrobbleData = {artist: state.artist || '',track: state.title || '',album: state.album || '',timestamp: Math.floor((Date.now() - state.seek) / 1000)};
		var msToScrobble = Math.round((state.duration/2)*1000); 	//And the track has been played for at least half its duration, 
		if (msToScrobble > 4*60*1000) {msToScrobble = 4*60*1000;}	//or for 4 minutes (whichever occurs earlier.)
		if ((state.title == this.previousState.title) && (state.artist == this.previousState.artist) && (state.album == this.previousState.album) && (msToScrobble > state.seek)) {
			msToScrobble -= state.seek; //cheap pause handling - let's just remove seek.
		} else 
		this.scrobbleTimeoutHandle = setTimeout(this.scrobbleTimeoutHandler.bind(this), msToScrobble);
	}
}

lastfmscrobble.prototype.stateHandler = function(state) {
	if ((state.status != this.previousState.status) || (state.title != this.previousState.title) || (state.artist != this.previousState.artist) || (state.album != this.previousState.album)) {
		this.stopTimers(); //stop existing timers
		switch (state.status) {
			case 'play':
				this.lfmNowPlaying(state);
				this.SetuplfmScrobble(state);
			break;
		}
	} else { //duplicate state. We get a lot of these at the start, so we filter them out. We might want to handle seek here on duplicate "play" states
		switch (state.status) {
			case 'play':
				this.log('Is this a seek???')
			break;
		}
	}		
	this.previousState = state;
}

lastfmscrobble.prototype.setupLastFM = function() {
	//todo: DANGER!! I have no idea how to use promises!
	var defer = libQ.defer();

	let Username = this.config.get('username') || '';
	let Password = this.config.get('password') || '';
	let ApiKey = this.config.get('api_key') || '';
	let Secret = this.config.get('api_secret') || '';
	let SessionKey = this.config.get('session_key') || '';

	if ( ( ((Username.length) && (Password.length)) || SessionKey.length) && (ApiKey.length) && (Secret.length)) { //We need either sessionkey or (username and password)
		this.lastfm = new lastfmNodeClient(ApiKey, Secret, SessionKey);
		if (!SessionKey) { //We need a session key
			this.lastfm.authGetMobileSession({
				username: Username,
				password: Password
			})
			.then(data => {
				//Toast login success
				this.commandRouter.pushToastMessage('info', "Account Login", "Login pending....");
				this.lastfm.sessionKey = data.session.key;
				this.config.set('session_key', data.session.key);
				this.config.save();
				return defer.resolve(data.session.key);
			})
			.catch(err => {
				//Toast login error
				return defer.reject(new Error(err));
			})
		} else {
			return defer.resolve('Logged in');
		}
	} else {
		this.lastfm = undefined;
		var missing = Username.length == 0 ? 'Username ' : '';
		missing += Password.length == 0 ? 'Password ' : '';
		missing += ApiKey.length == 0 ? 'API Key ' : '';
		missing += Secret.length == 0 ? 'Secret' : '';
		return defer.reject(new error('Missing values: ' + missing));
	}
	return defer.promise;
}

// Configuration Methods -----------------------------------------------------------------------------

lastfmscrobble.prototype.saveLastfmAccount = function( data ) {
	var self = this;
	var defer = libQ.defer();

	this.config.set('username', data['username']);
	this.config.set('password', data['password']);
	this.config.set('api_key', data['api_key']);
	this.config.set('api_secret', data['api_secret']);
	this.config.delete('session_key'); //remove the session_key to force authentication

	//do login and resolv on succes, reject on fail
	this.setupLastFM(); //set up and test the data
	if (this.lastfm == undefined) { //todo: add working code
		self.commandRouter.pushToastMessage('error', 'Account Login', 'last.fm login failed!');
		defer.reject('saveLastfmAccount - Configuration Error')
	} else  {
		self.commandRouter.pushToastMessage('success', "Account Login", 'The configuration has been successfully updated ' + data['username'] + ' logged in.');
		defer.resolve({});
	}
	return defer.promise;
}

lastfmscrobble.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
			uiconf.sections[0].content[0].value = self.config.get('username');
			uiconf.sections[0].content[1].value = self.config.get('password');
			uiconf.sections[0].content[2].value = self.config.get('api_key');
			uiconf.sections[0].content[3].value = self.config.get('api_secret');

            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

lastfmscrobble.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

lastfmscrobble.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

lastfmscrobble.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

lastfmscrobble.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};