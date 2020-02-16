'use strict';
var libQ = require('kew');
var fs=require('fs-extra'); //can i delete these 4 lines? there's an inline for v-conf and the rest are unused.
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var lcd = require('./lcd');
var lcdutils = require('./lcdutils');

const days = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
const months = ['Jan.', 'Feb.', 'Mars', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Des.'];

module.exports = lcdisplay;
function lcdisplay(context) {
	var self = this;
	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
	this.inStateHandler = false;
}

lcdisplay.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

    return libQ.resolve();
}

lcdisplay.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();
	
	this.previousState = {status: '', title: '', artist: '', album: ''}; //clear this again for good measure :)

	// set up LCD display
	this.lcd = new lcd(16, 2, 8, 0x20);
	
	this.intervalHandle = null; //they are not undefined, i have defined them to null :)
	this.timeoutHandle = null;
	this.startPlayTime = 0;

	//get the volumio version - it's a hack, but works. I know nothing about how to properly handle the promise :)
	var systemController = self.commandRouter.pluginManager.getPlugin('system_controller', 'system');
	var sysinfo = systemController.getSystemVersion();

	this.startupScreen = new lcdutils.lcdScreen(this.lcd); //make startup display - should mabe use let to not keep it in memory. unless we want to re-show on plugin restart?
	this.startupScreen.addStringSection('product', 'RSound v0.4', 16, 0, 0, 0); //Should come from plugin configuration "productname"
	this.startupScreen.addStringSection('player', 'Volumio ' + sysinfo._data.systemversion, 16, 0, 0, 1);
	this.startupScreen.showScreen();

	this.playScreen = new lcdutils.lcdScreen(this.lcd);
	this.playScreen.addStringSection('artistalbum', '', 16, 4, 0, 0);  //"Artist - Album" or just "Artist" for webradio - use whole screen width
	this.playScreen.addStringSection('songtitle', '', 10, 4, 0, 1);    //"Title" - we will stretch this for webradio as there is not (relevant) playtime
	this.playScreen.addStringSection('playtime', '', 5, 1, 11, 1);     //"MM:SS" of current song - disabled for pause and webradio
	this.playScreen.addStringSection('command', '', 5, 1, 11, 1);      //Enabled for pause, otherwise disabled

	this.stopScreen = new lcdutils.lcdScreen(this.lcd);
	var date = new Date(Date.now());
	this.stopScreen.addStringSection('day', days[date.getDay()], 8, 0, 0, 1); //wednesday
	this.stopScreen.addStringSection('date', String(date.getDate()).padStart(2, ' ') + '. ' + months[date.getMonth()] + ' ' + date.getFullYear(), 13, 0, 3, 0); // 31. Jan. 2020
	this.stopScreen.addStringSection('time', String(date.getHours()).padStart(2, '0') +':' + String(date.getMinutes()).padStart(2, '0'), 5, 0, 11, 1); // 22:00
	
	// Once the Plugin has successfull started resolve the promise
	defer.resolve();
    return defer.promise;
};

lcdisplay.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();
	//stop all timers
	this.clearTimers();
	// Stop the display
	this.lcd.finished();
	this.lcd = undefined;

    // Once the Plugin has successfull stopped resolve the promise
    defer.resolve();
    return libQ.resolve();
};

lcdisplay.prototype.onRestart = function() {
	var self = this;
    // Optional, use if you need it
};


// Configuration Methods -----------------------------------------------------------------------------

lcdisplay.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {


            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

lcdisplay.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

lcdisplay.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

lcdisplay.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

lcdisplay.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

lcdisplay.prototype.updateStopscreen = function() {
	var date = new Date(Date.now());
	this.stopScreen.getSection('day').string = days[date.getDay()];
	this.stopScreen.getSection('date').string = String(date.getDate()).padStart(2, ' ') + '. ' + months[date.getMonth()] + ' ' + date.getFullYear();
	this.stopScreen.getSection('time').string = String(date.getHours()).padStart(2, '0') +':' + String(date.getMinutes()).padStart(2, '0');
}

lcdisplay.prototype.screenTimeoutHandler = function() {
	this.clearTimers();
	this.lcd.backlightOff();
}

lcdisplay.prototype.stopTimeoutHandler = function() {
	this.clearTimers();
	this.updateStopscreen();
	this.stopScreen.showScreen();
	this.screenTimeoutHandle = setTimeout(this.screenTimeoutHandler.bind(this), 30*60*1000); //turn off screen after 30 min
	this.intervalHandle = setInterval(this.stopIntervalHandler.bind(this), 20000); //every 20 sec is enough? clock don't have to be that accurate...
}

lcdisplay.prototype.stopIntervalHandler = function() {
	this.updateStopscreen();
	this.stopScreen.update();
}

lcdisplay.prototype.playIntervalHandler = function() {
	if (this.playScreen.getSection('playtime').enabled) { //update time if enabled
		this.secondsPlayed = Math.round((Date.now() - this.startPlayTime) / 1000);//Math.round((moment() - this.startPlayTime) / 1000);
		this.playScreen.getSection('playtime').string = String(Math.floor(this.secondsPlayed / 60)).padStart(2, '0') + ':' + String(this.secondsPlayed % 60).padStart(2, '0');
	}
	this.playScreen.animate();
	this.playScreen.update();
}

lcdisplay.prototype.clearTimers = function() {
	if (this.intervalHandle) { //todo: maybe use just one variable for interval and one for timeout?
		clearInterval(this.intervalHandle);
		this.intervalHandle  = undefined;
	}

	if (this.timeoutHandle) {
		clearTimeout(this.timeoutHandle);
		this.timeoutHandle  = undefined;
	}

	if (this.screenTimeoutHandle) {
		clearTimeout(this.screenTimeoutHandle);
		this.screenTimeoutHandle = undefined;
	}
}

lcdisplay.prototype.log = function(message) {
	this.commandRouter.pushConsoleMessage('[lcdisplay] ' + message);
}

// receive updated State
lcdisplay.prototype.pushState = function(state) {
	if (state != undefined) {
		if ((state.status != this.previousState.status) || (state.title != this.previousState.title) || (state.artist != this.previousState.artist) || (state.album != this.previousState.album)) {
			this.clearTimers(); //clear timers
			//this.previousState = state; //I think it's best to set here, as we might get several calls during one update

			switch (state.status) {
				case 'play':
					this.playScreen.getSection('command').enabled = false; //disable command - we either want playtime or nothing
					this.playScreen.getSection('songtitle').string = state.title;
					if (state.stream === true) {
						//setup the playscreen for stream
						this.playScreen.getSection('artistalbum').string = state.artist;
						this.playScreen.getSection('songtitle').displayWidth = 16; //no playtime so we use full width
						this.playScreen.getSection('playtime').enabled = false;    //disable showing playtime
					} else {
						this.playScreen.getSection('artistalbum').string =  state.artist + ' - ' + state.album;
						this.playScreen.getSection('songtitle').displayWidth = 10; //make room for playtime
						this.playScreen.getSection('playtime').enabled = true;     //enable showing  playtime
						// set start time relative to seek
						this.startPlayTime = Date.now()-state.seek;  
						this.secondsPlayed = Math.round((Date.now() - this.startPlayTime) / 1000);  
						this.playScreen.getSection('playtime').string = String(Math.floor(this.secondsPlayed / 60)).padStart(2, '0') + ':' + String(this.secondsPlayed % 60).padStart(2, '0');

					}
					this.playScreen.showScreen();
					//start timer to update time every second
					this.previousState = state; //state is handled
					this.intervalHandle = setInterval(this.playIntervalHandler.bind(this), 1000); 
					break;
				case 'stop':
					this.previousState = state; //state is handled
					this.timeoutHandle = setTimeout(this.stopTimeoutHandler.bind(this), 2000); //wait 2 sec before we say it's stopped
					break;
				case '':
					this.previousState = state; //state is handled
					this.log('state is empty string - STOPED?');
					break;
				case 'pause':
					//there should be something playing so we adjust to make room for 'command', enable 'command' and disable 'playtime'
					this.playScreen.getSection('songtitle').displayWidth = 10;
					this.playScreen.getSection('command').enabled = true;
					this.playScreen.getSection('command').string = 'PAUSE';
					this.playScreen.getSection('playtime').enabled = false;

					//this.lcd.clearDisplay();
					this.playScreen.showScreen();

					this.previousState = state; //state is handled
					this.intervalHandle = setInterval(this.playIntervalHandler.bind(this), 2000); //only update ever 2 sec
					this.timeoutHandle = setTimeout(this.stopTimeoutHandler.bind(this), 60000); //after 60 sec pause assume we are stopped.
					break;
				default:
					this.previousState = state; //state is handled
					this.log('OTHER:' + state.status);
			}
		} else {
			switch (state.status) {
				case 'play':
					this.previousState = state; //state is handled
					this.startPlayTime = Date.now()-state.seek;
					break;
			}
		}
	} else {
		this.log('status is undefined')
	}

};