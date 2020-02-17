'use strict';

const libQ = require('kew');
const vconf = require('v-conf');

const io = require('socket.io-client');
const lastfmNodeClient = require('./lastfm-node-client');

const API_Key = '21a23727f312fbc71d512608c886df8d';
const API_Secret = 'f1261b4b754f90f9ef012a7e6ac8f060';

module.exports = lastfmscrobble;

/**
 * Volumio state object
 * @typedef {Object} volumioState
 * @property {string} status status of the state
 * @property {number} position position in playlist
 * @property {string} title title of song
 * @property {string} artist name of artist
 * @property {string} album name of album
 * @property {string} albumart uri to album art (I think this is always url)
 * @property {number} duration the duration of the song in seconds
 * @property {string} uri uri of the song
 * @property {number} seek current position in song in milliseconds
 * @property {string} samplerate textual representation of sample rate
 * @property {number} channels the number of channels in the song
 * @property {string} bitdepth textual representation of the bit depth
 * @property {boolean} Streaming if we are streaming the song
 * @property {string} service name of the service
 * @property {number} volume current volume of mixer
 * @property {boolean} mute true if muted (i'm guessing here)
 * @property {boolean} disableVolumeControl true if volume control is disabled (mixer = none)
 * @property {boolean} random true if playlist is played randomly, false if in order
 * @property {boolean} repeat true if playlist is on repeat
 * @property {boolean} repeatSingle true if song is on repeat
 * @property {boolean} updatedb true if mpd db shall be updated?
 * @property {boolean} consume true if in consume mode - i'm guessing this is if tracks shall be removed from playlist after play
 */

function lastfmscrobble(context) {
	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

lastfmscrobble.prototype.onVolumioStart = function () {
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new (vconf)();
	this.config.loadFile(configFile);
	return libQ.resolve();
}

lastfmscrobble.prototype.onStart = function () {
	var defer = libQ.defer();
	if (this.config.get('logdebug')) {
		this.logger.transports.file.level = 'debug';
	}
	//this.logger.info('lastfmscrobbler file transport level: ' + this.logger.transports.file.level, {label: 'Øistein'});
	this.previousState = { status: '', title: '', artist: '', album: '' }; //better would be to use getEmptyState from CoreStateMachine
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

lastfmscrobble.prototype.onStop = function () {
	var self = this;
	var defer = libQ.defer();
	this.stopTimers();
	// Once the Plugin has successfull stopped resolve the promise
	defer.resolve();
	return libQ.resolve();
};

// lastfmscrobble Methods -----------------------------------------------------------------------------

/**
 * Sends data to the log with loglevel info
 * @param {string} logstring - The string to log
 */
lastfmscrobble.prototype.log = function (logstring) { //shortcut to info logging
	if (this.config.get('loginfo')) {
		this.logger.info('[lastfmscrobble] ' + logstring);
	}
}

/**
 * Sends data to the log with loglevel debug
 * @param {string} logstring - The string to log
 */
lastfmscrobble.prototype.debug = function (logstring) { //shortcut to debug logging
	if (this.config.get('logdebug')) {
		this.logger.debug('[lastfmscrobble] ' + logstring); //We might opt for JSON.stringify(string) to be able to accept anything
	}
}

lastfmscrobble.prototype.setlfmScrobbledata = function (state) {
	this.lfmScrobbleData = { timestamp: Math.floor(Date.now() / 1000) }; //clear variable, and add timestamp
	if (state['service'] === 'webradio') { //handle webradio - split artist into album and artist and ignore album
		let artrack = state['title'].split(' - ');
		if (artrack.length == 2) {
			this.lfmScrobbleData['artist'] = artrack[0];
			this.lfmScrobbleData['track'] = artrack[1];
			this.lfmScrobbleData['chosenByUser'] = 0; //this is not choosen by the user
		}
	} else { //not webradio
		if (state['title']) { this.lfmScrobbleData['track'] = state['title'] } //set track 
		if (state['artist']) { this.lfmScrobbleData['artist'] = state['artist'] } //set artist
		if (state['album']) { this.lfmScrobbleData['album'] = state['album'] } //set album
	}
}

/**
 * Handler for the scrobble timeout
 */
lastfmscrobble.prototype.scrobbleTimeoutHandler = function () {
	this.previouslfmScrobbleData = this.lfmScrobbleData; //Store scrobble for check later
	this.debug('Starting scrobble');
	this.lastfm.trackScrobble(this.lfmScrobbleData)
		.then(this.lfmScrobbleOk.bind(this))
		.catch(this.lfmFail.bind(this))
}

/**
 * Handler for a successful call to trackScrobble
 * @param {Object} data - The result of the call. See https://www.last.fm/api/show/track.scrobble
 */
lastfmscrobble.prototype.lfmScrobbleOk = function (data) {
	if (data.scrobbles['@attr'].accepted == 1) {
		this.debug('Scrobble success: ' + data.scrobbles.scrobble.artist['#text'] + ' - ' + data.scrobbles.scrobble.album['#text'] + ' - ' + data.scrobbles.scrobble.track['#text']);
		if (this.config.get('toastscrobbles')) { //If toast is enabled
			this.commandRouter.pushToastMessage('success', "last.fm scrobble", "Scrobbled " + data.scrobbles.scrobble.artist['#text'] + ' - ' + data.scrobbles.scrobble.track['#text']);
		}
	} else {
		this.logger.warn('Scrobble IGNORED: ' + data.scrobbles.scrobble.ignoredMessage.code + ':' + data.scrobbles.scrobble.ignoredMessage["#text"]);
		this.logger.warn(JSON.stringify(data));
	}
}

/**
 * Handler for a successful call to updateNowPlaying
 * @param {Object} data - The result of the call. See https://www.last.fm/api/show/track.updateNowPlaying
 */
lastfmscrobble.prototype.lfmUpdateNowPlayingOk = function (data) {
	if (data.nowplaying.ignoredMessage.code == 0) {
		this.debug('UpdateNowPlaying: ' + data.nowplaying.artist['#text'] + ' - ' + data.nowplaying.album['#text'] + ' - ' + data.nowplaying.track['#text']);
	} else {
		this.logger.warn('UpdateNowPlaying IGNORED: ' + data.nowplaying.ignoredMessage.code + ':' + data.nowplaying.ignoredMessage["#text"]);
		this.logger.warn(JSON.stringify(data));
	}
}

/**
 * Handler for any failed last.fm call
 * @param {Object} err Values will depend on call. See https://www.last.fm/api/errorcodes
 */
lastfmscrobble.prototype.lfmFail = function (err) {
	this.logger.error('LastFM call failed :' + JSON.stringify(err));
}

/**
 * Ask last.fm to update now playing based on current information in lfmScrobbleData 
 */
lastfmscrobble.prototype.lfmNowPlaying = function () {
	this.lastfm.trackUpdateNowPlaying(this.lfmScrobbleData)
		.then(this.lfmUpdateNowPlayingOk.bind(this))
		.catch(this.lfmFail.bind(this));
}

/**
 * Checks if this is a new scrobble
 * @returns {boolean} True if new scrobble
 */
lastfmscrobble.prototype.isNewScrobble = function () {
	if (this.previouslfmScrobbleData) {
		return ((this.lfmScrobbleData['artist'] != this.previouslfmScrobbleData['artist']) || (this.lfmScrobbleData['track'] != this.previouslfmScrobbleData['track']) || (this.lfmScrobbleData['album'] != this.previouslfmScrobbleData['album']));
	} else {
		return true;
	}
}

/**
 * Set up scrobble timer
 * @param {volumioState} state Volumio state object
 */
lastfmscrobble.prototype.SetuplfmScrobble = function (state) {
	if (this.isNewScrobble()) {
		if (state['service'] === 'webradio') { //for web radio we scrobble after 30 seconds (this is minimum song length to scrobble)
			if (this.config.get('scobblewebradio')) {
				this.log('Will scrobble ' + state.title + ' in 0:30 (webradio)');
				this.scrobbleTimeoutHandle = setTimeout(this.scrobbleTimeoutHandler.bind(this), 30 * 1000); //delay for 30 sec
			}
		} else {
			if (state.duration > 30) { 	//The track must be longer than 30 seconds, and play for min 50% or 4 minutes
				let msToScrobble = Math.min(
					Math.round((state.duration / 2) * 1000),
					4 * 60 * 1000);
				if ((state.title == this.previousState.title) && (state.artist == this.previousState.artist) && (state.album == this.previousState.album) && (msToScrobble > state.seek)) {
					msToScrobble = Math.max(msToScrobble - state.seek, 0); //cheap pause handling - let's just remove seek. 50% can be first 25 and last 25 :)
				}
				this.log('Will scrobble ' + state.artist + ' - ' + state.title + '(' + state.album + ') in ' + Math.floor(msToScrobble / 60000) + ':' + Math.round(msToScrobble / 1000) % 60);
				this.scrobbleTimeoutHandle = setTimeout(this.scrobbleTimeoutHandler.bind(this), msToScrobble);
			}
		}
	} else {
		this.debug('Already scrobbled ' + JSON.stringify(this.lfmScrobbleData));
	}
}

/**
 * Handler for the socket.io state change
 * @param {volumioState} state Volumio state object
 */
lastfmscrobble.prototype.stateHandler = function (state) {
	if ((state.status != this.previousState.status) || (state.title != this.previousState.title) || (state.artist != this.previousState.artist) || (state.album != this.previousState.album)) {
		this.stopTimers(); //stop existing timers
		switch (state.status) {
			case 'play':
				this.debug('PLAY detected');
				this.setlfmScrobbledata(state);
				this.lfmNowPlaying();
				this.SetuplfmScrobble(state);
				break;
		}
		this.previousState = state; //We have handled this state
	}
}

/**
 * Set up the last.fm object and get a session key if needed
 * Does not authenticate if we have a session key
 * @returns {promise} resolved promise if all is OK, rejected otherwise
 */
lastfmscrobble.prototype.setupLastFM = function () {
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
				this.debug('LastFM auth.getMobileSession failed  - ' + JSON.stringify(err));
				defer.reject('Wrong LastFM username or password');
			})
	} else { //Assume the SessionKey is OK :)
		defer.resolve('LastFM login OK')
	}
	return defer.promise; //should not be able to get here!
}

/**
 * clears the timer
 */
lastfmscrobble.prototype.stopTimers = function () {
	if (this.scrobbleTimeoutHandle) {
		clearTimeout(this.scrobbleTimeoutHandle);
		this.scrobbleTimeoutHandle = 0;
	}
}

// Configuration Methods -----------------------------------------------------------------------------

lastfmscrobble.prototype.saveLoggSettings = function (data) {
	var defer = libQ.defer();

	this.config.set('loginfo', data['loginfo']);
	this.config.set('logdebug', data['logdebug']);
	this.config.save();
	this.logger.transports.file.level = data['logdebug'] ? 'debug' : 'info';

	this.commandRouter.pushToastMessage('success', 'Log settings', 'Settings saved');
	defer.resolve('Log settings saved');
	return defer.promise;
}

lastfmscrobble.prototype.savePluginSettings = function (data) {
	var defer = libQ.defer();

	this.config.set('toastscrobbles', data['toastscrobbles']);
	this.config.set('scobblewebradio', data['scobblewebradio']);
	this.config.save();
	this.commandRouter.pushToastMessage('success', 'Plugin settings', 'Settings saved');
	defer.resolve('Plugin settings saved');
	return defer.promise;
}

lastfmscrobble.prototype.saveLastfmAccount = function (data) {
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
			defer.reject('saveLastfmAccount - Configuration Error: ' + error)
		})
	return defer.promise;
}

lastfmscrobble.prototype.getUIConfig = function () {
    var self = this;
	var defer = libQ.defer();

	var lang_code = this.commandRouter.sharedVars.get('language_code');

	this.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function (uiconf) {
			//user
			uiconf.sections[0].content[0].value = self.config.get('username');
			uiconf.sections[0].content[1].value = self.config.get('password');

			//settings
			uiconf.sections[1].content[0].value = self.config.get('toastscrobbles');
			uiconf.sections[1].content[1].value = self.config.get('scobblewebradio');

			//logsetting 
			uiconf.sections[2].content[0].value = self.config.get('loginfo');
			uiconf.sections[2].content[1].value = self.config.get('logdebug');

			defer.resolve(uiconf);
		})
		.fail(function (error) {
			defer.reject(error);
		});

	return defer.promise;
};

lastfmscrobble.prototype.getConfigurationFiles = function () {
	return ['config.json'];
}