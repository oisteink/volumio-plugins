'use strict';

class lcdAnimatedString {
    constructor(string, displayWidth, wait, animateEvery = 1) {
        this.string = string;
        this.displayWidth = displayWidth; //"width" of the resulting animated string
        this.wait = wait; //number of animations to skip at start and end - it is 0 based
        this.curWait = wait;
        this.position = 0;
        this.animateEvery = animateEvery;
        this.tick = 0;
    }

    /*set displayWidth(value) {
        if (this._displayWidth != value){
            this._displayWidth = value;
            this.position = 0;
        }

    }*/

    /**
     * @param {String} value
     */
    set string(value) { // set internal string and reset position
        if (this._string != value) {
            this._string = value;
            this.position = 0;
        }
    }

    animate (){
        //if (this.animateEvery > 1) { console.log(this._string + ' ' + this.tick % this.animateEvery + ' ' + this.position + ' ' + this.curWait) };
        if (this._string.length > this.displayWidth) { //only animate strings longer than the displayWidth
            //if (this.position > (this._string.length - this.displayWidth) { this.position = this.displayWidth } //can happen if we change displayWidth - let's handle this with a setter, or just set pos in else :)
            if (this.tick % this.animateEvery == 0) {
                switch (this.position) {
                    case 0:
                        if (this.curWait == 0) {
                            this.curWait = this.wait;
                            this.position++;
                        } else {
                            this.curWait--;
                        }
                        break;
                    case this._string.length - this.displayWidth:
                        if (this.curWait == 0) {
                            this.curWait = this.wait;
                            this.position = 0;
                        } else {
                            this.curWait--;
                        }
                        break;
                    default:
                        this.position++;
                        
                }
            }
        } else {
            this.position = 0;
        }
        this.tick++; //Advance animation tick
    }

    get animatedString(){
        return this._string.padEnd(this.position + this.displayWidth, ' ').substring(this.position, this.position + this.displayWidth);
    }
   
} //lcdAnimatedString

class lcdStringSection extends lcdAnimatedString {
    constructor (string, displayWidth, delayUpdate, x, y, enabled = true, animateEvery = 1) {
        super(string, displayWidth, delayUpdate, animateEvery);
        this.y = y;
        this.x = x;
        this.enabled = enabled;
    }
} //lcdStringSection

class lcdScreen {
    constructor(lcd) {
        this.lcd = lcd;
        this.sectionData = [];
        this.sectionNames = [];
    }

    addStringSection(sectionName, string, displayWidth, delayUpdate, col, row, enabled = true, animateEvery = 1) {
        //todo: throw error if section allready exists
        this.sectionNames.push(sectionName);
        return this.sectionData.push(new lcdStringSection(string, displayWidth, delayUpdate, col, row, enabled, animateEvery));
    }

    deleteSection(sectionName) {
        var index = this.sectionNames.indexOf(sectionName);
        if (index > -1) {
            this.sectionNames.splice(index, 1);
            this.sectionData.splice(index, 1);
        }
    }

    getSection(sectionName) { //gets a section and creates it if missing
        var index = this.sectionNames.indexOf(sectionName);
        if (index < 0) {
            return undefined;
        } else {
            return this.sectionData[index];
        }
    }

    animate() {
        this.sectionData.forEach(
            function(value) {
                if (value.enabled) {
                    value.animate()
                }
            }, this
        );
    }

    showScreen() {
        this.lcd.backlightOn();
        this.lcd.clearDisplay();
        this.update();
    }

    update() {
        this.sectionData.forEach((section) => {
            if (section.enabled) {
                this.lcd.setCursorPos(section.x, section.y);
                this.lcd.writeString(section.animatedString);
            }
        });
    }
} //lcdScreen

module.exports = {lcdScreen, lcdStringSection, lcdAnimatedString};