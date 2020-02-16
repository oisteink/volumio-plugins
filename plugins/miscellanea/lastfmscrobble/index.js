'use strict';

const libQ = require('kew');
const vconf = require('v-conf');

const io = require('socket.io-client');
const lastfmNodeClient = require('./lastfm-node-client');

const API_Key = '21a23727f312fbc71d512608c886df8d';
const API_Secret = 'f1261b4b754f90f9ef012a7e6ac8f060';

module.exports = lastfmscrobble;
function lastfmscrobble(context) {
	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

lastfmscrobble.prototype.onVolumioStart = function()
{
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (vconf)();
	this.config.loadFile(configFile);
    return libQ.resolve();
}

lastfmscrobble.prototype.onStart = function() {
	var defer=libQ.defer();
	this.previousState = {status: '', title: '', artist: '', album: ''}; //better would be to use getEmptyState from CoreStateMachine
	this.scrobbleTimeoutHandle = 0;
	this.lfmScrobbleData = {};
	this.previouslfmScrobbleData = undefined; //It's not yet defined
	this.setupLastFM()
	.then(message => {
		this.socket = io.connect('http://localhost:3000');
		this.socket.on('pushState', this.stateHandler.bind(this));
		defer.resolve('onStart done ' + message);
	})
	.fail(error => {
		this.logger.error(error);
		defer.reject(error)
	});
	return defer.promise;
};

lastfmscrobble.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
	this.stopTimers();
    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();
    return libQ.resolve();
};

// lastfmscrobble Methods -----------------------------------------------------------------------------

lastfmscrobble.prototype.log = function(string) { //shortcut to info logging
	this.logger.info('[lastfmscrobble] ' + string);
}

lastfmscrobble.prototype.scrobbleTimeoutHandler = function() {
	this.previouslfmScrobbleData = this.lfmScrobbleData;
	this.lastfm.trackScrobble(this.lfmScrobbleData)
	.then(this.lfmScrobbleOk.bind(this))
	.catch(this.lfmFail.bind(this))
}

lastfmscrobble.prototype.stopTimers = function() {
	if (this.scrobbleTimeoutHandle) {
		clearTimeout(this.scrobbleTimeoutHandle);
		this.scrobbleTimeoutHandle = 0;
	}
}

lastfmscrobble.prototype.lfmScrobbleOk = function(data) {
	if (data.scrobbles['@attr'].accepted == 1) {
		this.log('Scrobble success: '+data.scrobbles.scrobble.artist['#text'] + ' - ' + data.scrobbles.scrobble.album['#text'] + ' - ' + data.scrobbles.scrobble.track['#text']);
		//If toast is enabled
		this.commandRouter.pushToastMessage('success', "last.fm scrobble", "Scrobbled "+data.scrobbles.scrobble.artist['#text'] + ' - ' + data.scrobbles.scrobble.track['#text']);
	} else {
		this.logger.warn('Scrobble IGNORED: ' + data.scrobbles.scrobble.ignoredMessage.code + ':' + data.scrobbles.scrobble.ignoredMessage["#text"]);
		this.logger.warn(JSON.stringify(data));
	}
}

lastfmscrobble.prototype.lfmUpdateNowPlayingOk = function(data) {
	if (data.nowplaying.ignoredMessage.code == 0) {
		this.log('UpdateNowPlaying: '+data.nowplaying.artist['#text'] + ' - ' + data.nowplaying.album['#text'] + ' - ' + data.nowplaying.track['#text']);
	} else {
		this.logger.warn('UpdateNowPlaying IGNORED: ' + data.nowplaying.ignoredMessage.code + ':' + data.nowplaying.ignoredMessage["#text"]);
		this.logger.warn(JSON.stringify(data));
	} 
}

lastfmscrobble.prototype.lfmFail = function(err) {
	this.logger.error('LastFM call failed :' + JSON.stringify(err));
}

lastfmscrobble.prototype.setlfmScrobbledata = function(state) {
	this.lfmScrobbleData = {timestamp: Math.floor(Date.now() / 1000)}; //clear variable, and add timestamp
	if (state['service'] === 'webradio') { //handle webradio - split artist into album and artist and ignore album
		let artrack = state['title'].split(' - ');
		if (artrack.length == 2) {
			this.lfmScrobbleData['artist'] = artrack[0];
			this.lfmScrobbleData['track'] =  artrack[1];
			this.lfmScrobbleData['chosenByUser'] = 0; //this is not choosen by the user
		} 
	} else { //not webradio
		if (state['title']) { this.lfmScrobbleData['track'] = state['title']} //set track 
		if (state['artist']) { this.lfmScrobbleData['artist'] = state['artist']} //set artist
		if (state['album']) { this.lfmScrobbleData['album'] = state['album']} //set album
	}
}

lastfmscrobble.prototype.lfmNowPlaying = function() {
	this.lastfm.trackUpdateNowPlaying(this.lfmScrobbleData)
	.then(this.lfmUpdateNowPlayingOk.bind(this))
	.catch(this.lfmFail.bind(this));
}

lastfmscrobble.prototype.isNewScrobble = function() {
	if (this.previouslfmScrobbleData) {
		return ((this.lfmScrobbleData['artist'] != this.previouslfmScrobbleData['artist']) || (this.lfmScrobbleData['track'] != this.previouslfmScrobbleData['track']) || (this.lfmScrobbleData['album'] != this.previouslfmScrobbleData['album']));
	} else {
		return true;
	}

}

lastfmscrobble.prototype.SetuplfmScrobble = function(state) {
	if (this.isNewScrobble()) {
		if(state['service'] === 'webradio') { //for web radio we scrobble straight away
			this.scrobbleTimeoutHandle = setTimeout(this.scrobbleTimeoutHandler.bind(this), 30*1000); //delay for 30 sec
		} else {
			if (state.duration > 30) { 	//The track must be longer than 30 seconds, and play for min 50% or 4 minutes
				let msToScrobble = Math.min(
					Math.round((state.duration/2)*1000),
					4*60*1000);
				if ((state.title == this.previousState.title) && (state.artist == this.previousState.artist) && (state.album == this.previousState.album) && (msToScrobble > state.seek)) {
					msToScrobble = Math.max(msToScrobble-state.seek, 0); //cheap pause handling - let's just remove seek. 50% can be first 25 and last 25 :)
				} 
				this.scrobbleTimeoutHandle = setTimeout(this.scrobbleTimeoutHandler.bind(this), msToScrobble);
			}
		}
	} else {
		this.log('Already scrobbled ' + JSON.stringify(this.lfmScrobbleData));
	}
}

lastfmscrobble.prototype.stateHandler = function(state) {
	if ((state.status != this.previousState.status) || (state.title != this.previousState.title) || (state.artist != this.previousState.artist) || (state.album != this.previousState.album)) {
		this.stopTimers(); //stop existing timers
		switch (state.status) {
			case 'play':
				this.setlfmScrobbledata(state);
				this.lfmNowPlaying();
				this.SetuplfmScrobble(state);
			break;
		}
		this.previousState = state; //We have handled this state
	}
}

lastfmscrobble.prototype.setupLastFM = function() {
	var defer = libQ.defer();
	let Username = this.config.get('username') || '';
	let Password = this.config.get('password') || '';
	let SessionKey = this.config.get('session_key') || '';
	this.lastfm = new lastfmNodeClient(API_Key, API_Secret, SessionKey);
	if (!SessionKey) { //We need a session key
		this.lastfm.authGetMobileSession({ username: Username, password: Password })
		.then(data => {
			this.lastfm.sessionKey = data.session.key;
			this.config.set('session_key', data.session.key);
			this.config.save();
			defer.resolve('LastFM login OK');
		})
		.catch(err => {
			this.logger.warn('LastFM auth.getMobileSession failed  - ' + err);
			defer.reject('Wrong LastFM username or password');
		})
	} else { //Assume the SessionKey is OK :)
		defer.resolve('LastFM login OK') 
	} 
	return defer.promise; //should not be able to get here!
}


// Configuration Methods -----------------------------------------------------------------------------

lastfmscrobble.prototype.saveLastfmAccount = function( data ) {
	var self = this;
	var defer = libQ.defer(); //No idea if caller handles promises, but better safe than sorry

	this.config.set('username', data['username']);
	this.config.set('password', data['password']);
	this.config.delete('session_key'); //remove the session_key to force authentication in setupLastFM

	//do login and resolv on succes, reject on fail
	this.setupLastFM()
	.then(message => {
		this.commandRouter.pushToastMessage('success', "Account Login", 'The configuration has been successfully updated ' + data['username'] + ' logged in.');
		defer.resolve(message);
	})
	.fail(error => {
		this.commandRouter.pushToastMessage('error', 'Account Login', 'last.fm login failed!');
		defer.reject('saveLastfmAccount - Configuration Error: '+error)
	})
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

/*lastfmscrobble.prototype.setUIConfig = function(data) {
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
};*/