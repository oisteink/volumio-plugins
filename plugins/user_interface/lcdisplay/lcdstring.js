'use strict';

class lcdString {
    constructor(str, length, wait) {
        this.str = str;
        this.length = length;
        this.wait = wait;
        this.curWait = wait;
        this.position = 0;
    }

    animate (){
        if (this.str.length > this.length) {
            switch (this.position) {
                case 0:
                    if (this.curWait == 0) {
                        this.curWait = this.wait;
                        this.position++;
                    } else {
                        this.curWait--;
                    }
                    break;
                case this.str.length - this.length:
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
    }

    getStringPart(){
        return this.str.padEnd(this.position + this.length, ' ').substring(this.position, this.position + this.length);
    }
}

module.exports = lcdString;