'use strict';

const sleep = require('sleep');
const i2c = require('i2c-bus');

// LCD Commands
const LCD_CLEARDISPLAY = 0x01; //Clear display

const LCD_RETURNHOME = 0x02; //Cursor and shift home

const LCD_SETENTRYMODE = 0x04; //Entry mode set
const LCD_ENTRYRIGHT = 0x02;    //Move DDRAM pointer right on entry (write or read)
const LCD_ENTRYLEFT = 0x00;     //Move DDRAM pointer left on entry (write or read)
const LCD_ENTRYDISPLAYSHIFT = 0x01;  //Move display on entry (write or read)
const LCD_ENTRYNODISPLAYSHIFT = 0x00;

const LCD_SETDISPLAYCONTROL = 0x08; //Display and cursor on/off control
const LCD_DISPLAYON = 0x04; //Turns display on (not backlight)
const LCD_DISPLAYOFF = 0x00; //Turns display off (not backlight)
const LCD_CURSORON = 0x02; //Shows cursor (underline)
const LCD_CURSOROFF = 0x00; //hides cursor (underline)
const LCD_BLINKON = 0x01; //Shows blinking cursor (block)
const LCD_BLINKOFF = 0x00; //no blinking cursor (block)

const LCD_SHIFT = 0x10; //Command shifts the cursor or the display by 1
const LCD_SHIFTCURSOR = 0x00; //Select cursorshift
const LCD_SHIFTDISPLAY = 0x08; //Select displayshift
const LCD_SHIFTRIGHT = 0x04; //Sets direction to right according to above
const LCD_SHIFTLEFT = 0x00; //Sets direction to left according to avobe.

const LCD_SETFUNCTION = 0x20; //Data interface lenght, line count and 8/10bit font
const LCD_4BITMODE = 0x00; //Data interface is 4bit
const LCD_8BITMODE = 0x10; //Data interface is 8bit
const LCD_1LINE = 0x00; //1 line display
const LCD_2LINE = 0x08; //2 line display
const LCD_5x8DOTS = 0x00; //5x8 font
const LCD_5x10DOTS = 0x04; //5x10 font

const LCD_SETCGRAMADDR = 0x40; //Sets CGRAM address, lower 6 bits are address - used to set custom characters
const LCD_SETDDRAMADDR = 0x80; //Sets DDRAM address, lower 7 bits are address - used to move cursor


// Flags for function set

class LCD_hd44780 {
    constructor(cols = 16, lines = 2, fontSize = 8, dataLength = 4) {  //Standard values 16x2 charset 8pix
        this.cols = cols;
        this.lines = lines;
        this.fontSize = fontSize;

        //set up LCD flags
        switch (dataLength) {
            case 4: this.lcdDataLength = LCD_4BITMODE; break;
            case 8: this.lcdDataLength = LCD_8BITMODE; break;
            default: throw new Error('Invalid data length')
        }

        switch (lines) {
            case 1: this.lcdLines = LCD_1LINE; break;
            case 2: this.lcdLines = LCD_2LINE; break;
            default: throw new Error('Invalid number of lines');
        }

        switch (fontSize) {
            case 8: this.lcdFont = LCD_5x8DOTS; break;
            case 10: this.lcdFont = LCD_5x10DOTS; break;
            default: throw new Error('Invalid font size');
        }

        //set up default values
        this.setDefaults();

        this.writeCommand(this.displayControl);
        this.writeCommand(this.displayFunction);
        this.writeCommand(this.displayEntryMode);

        this.setCustomChars();
        this.clearDisplay();
        this.backlightOn();
        this.displayOn();
    }

    setDefaults() {
        //set default entry values - Move right on entry, no displayshift
        this.lcdEntryShift = LCD_ENTRYRIGHT;
        this.lcdEntryDisplayShift = LCD_ENTRYNODISPLAYSHIFT;

        //Set default control values - Display on, Cursor off, Blink off - //move to boolean setters and getters?
        this.lcdDisplayOn = LCD_DISPLAYON;
        this.lcdCursor = LCD_CURSOROFF;
        this.lcdBlink = LCD_BLINKOFF;

        //set backlight on
        this.lcdBacklight = true;
    }

    setup4bit() {
        this.write4bits((LCD_FUNCTIONSET | LCD_8BITMODE) >> 4); //shift left 4 (we only write the top 4 bits)
        sleep.usleep(4100); //wait 4.1ms
        this.write4bits((LCD_FUNCTIONSET | LCD_8BITMODE) >> 4);
        sleep.usleep(100);  //wait 100μs
        this.write4bits((LCD_FUNCTIONSET | LCD_8BITMODE) >> 4); //Here we know for sure it's in 8bit mode
        this.write4bits((LCD_FUNCTIONSET | LCD_4BITMODE) >> 4); //Finally set 4bit mode. From here on we use 2x4bit writes.
    }

    setup8bit() {
        this.write8bits(LCD_FUNCTIONSET | LCD_8BITMODE);
        sleep.usleep(4100); //wait 4.1ms
        this.write8bits(LCD_FUNCTIONSET | LCD_8BITMODE);
        sleep.usleep(100);  //wait 100μs
        this.write4bits(LCD_FUNCTIONSET | LCD_8BITMODE); //Finally set 8bit mode.
    }

    write4bits(data, isData = false) {
        throw new Error('write4bits is not implemented');//abstract, latch 4 bits set RS if it's data and toggle enable - interface dependant
    }

    write8bits(data, isData = false) { //Needs override if 8bit data lenght
        if (this.dataLength == LCD_4BITMODE) {
            this.write4bits(bits >> 4, isData);    //top 4 bits
            this.write4bits((data & 0x0F), isData) //bottom 4 bits;
        } else { throw new Error('write8bits is not implemented'); }
    }

    writeCommand(command) {
        //Register select = 0
        this.write8bits(command);
    }

    writeChar(char) {
        //Set Register Select
        this.write8bits(command, )
    }

    // class fields
    get displayEntryMode() { return LCD_SETENTRYMODE | this.lcdEntryShift | this.lcdEntryDisplayShift }

    get displayControl() { return LCD_SETDISPLAYCONTROL | this.lcdDisplayOn | this.lcdCursor | this.lcdBlink };

    get displayFunction() { return LCD_SETFUNCTION | this.lcdDataLength | this.lcdLines | this.lcdFont };
}

// Adafruit i2c/SPI LCD Backpack - only i2c mode supported
const MCP23008_IODIR = 0;
const MCP23008_GPIO = 0x09;

//MCD23008 pins: BL D7 D6 D5 D4 EN RS  -
const MCP23008_RW =        0x01; // R/W is not connected - always low (write)
const MCP23008_RS =        0x02; // Register select. High writes Data, Low writes instructions
const MCP23008_ENABLE =    0x04; // Enable bit
const MCP23008_BACKLIGHT = 0x80; // Backlight bit
const MCP23008_NOBACKLIGHT = 0x00; // No backlight bit
const MCP230XX_DATASHIFT = 3; //shift data 3 positions to the left into D7-D4


class LCD_adafruitI2C extends LCD_hd44780 {
    constructor(cols = 16, rows = 2, dotSize = 8, bitMode, i2sAddr = 0x20) {
        //set up backpack
        this.i2sAddr = i2sAddr;
        this.i2caddress = i2caddress;
        this.i2cbus = i2c.openSync(1); //Hardcoded bus 1
        this.i2cbus.writeByteSync(i2caddress, MCP23008_IODIR, 0); //Set pins to output
        //set up lcd
        super(cols, rows, dotSize, bitMode);
    }

    write4bits(data, isData = false) { //We get the data in the lower 4 bits, output is: //MCP23008 pins: BL D7 D6 D5 D4 EN RS  -

        bits = (data << MCP230XX_DATASHIFT);
        bits |= (this.lcdBacklight) ? MCP23008_BACKLIGHT : MCP23008_NOBACKLIGHT;
        bits |= (isData) ? MCP23008_RS : 0;
        // Pulse enable
        this.i2cbus.writeByteSync(this.i2caddress, MCP23008_GPIO, bits | MCP23008_ENABLE);
        sleep.usleep(250); 

        // End pulse enable
        this.i2cbus.writeByteSync(this.i2caddress, MCP23008_GPIO, bits);
        sleep.usleep(250);
    }
}
