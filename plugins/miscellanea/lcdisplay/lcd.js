'use strict';
var assert = require('assert');
const i2c = require('i2c-bus');
const sleep = require('sleep');


const MCP23008_IODIR = 0;
const MCP23008_GPIO = 0x09;

// LCD Commands
const LCD_CLEARDISPLAY = 0x01
const LCD_RETURNHOME = 0x02
const LCD_ENTRYMODESET = 0x04
const LCD_DISPLAYCONTROL = 0x08
const LCD_CURSORSHIFT = 0x10
const LCD_FUNCTIONSET = 0x20
const LCD_SETCGRAMADDR = 0x40
const LCD_SETDDRAMADDR = 0x80
const LCD_DISPLAYON = 0x04;
const LCD_DISPLAYOFF = 0x00;
const LCD_CURSORON = 0x02;
const LCD_CURSOROFF = 0x00;
const LCD_BLINKON = 0x01;
const LCD_BLINKOFF = 0x00;

// flags for display entry mode // todo: make understandable names
const LCD_ENTRYRIGHT = 0x00; //decrements by 1 when writing (writing from the righ)
const LCD_ENTRYLEFT = 0x02;  //increments by 1 when writing (writing from the left)
const LCD_ENTRYSHIFTINCREMENT = 0x01; //shifts the display when writing
const LCD_ENTRYSHIFTDECREMENT = 0x00; //display does not shift

// Flags for display/cursor shift
const LCD_DISPLAYMOVE = 0x08;
const LCD_CURSORMOVE = 0x00;
const LCD_MOVERIGHT = 0x04;
const LCD_MOVELEFT = 0x00;

// Flags for function set
const LCD_8BITMODE = 0x10;
const LCD_4BITMODE = 0x00;
const LCD_2LINE = 0x08;
const LCD_1LINE = 0x00;
const LCD_5x10DOTS = 0x04;
const LCD_5x8DOTS = 0x00;

// Flags for RS pin modes
const RS_INSTRUCTION = 0x00; //see MCP23008_RS
const RS_DATA = 0x01;

//MCD23008 pins: BL D7 D6 D5 D4 EN RS  -
//    MCP23008_RW =        0x01; // R/W is not connected - always low (write)
const MCP23008_RS =        0x02; // Register select. High writes Data, Low writes instructions
const MCP23008_ENABLE =    0x04; // Enable bit
const MCP23008_BACKLIGHT = 0x80; // Backlight bit
const MCP23008_NOBACKLIGHT = 0x00; // No backlight bit
const MCP230XX_DATASHIFT = 3; //shift data into D7-D4

class MCP23008_CharLCD {
    constructor(cols = 16, rows = 2, dotsize = 8, i2caddress = 0x20) {
        assert(cols < 21, 'Max 20 columns');
        assert(rows < 3, 'Max 2 rows');
        assert((dotsize == 8) | (dotsize == 10), 'Dotsize can be 8 or 10');
        assert(~((dotsize == 10) && (rows > 1)), ((dotsize == 10) && (rows > 1)) + ' Only 1 ('+(rows > 1)+')row if dotsize is 10 ('+(dotsize==10)+')');
        this.cols = cols;
        this.rows = rows;
        this.dotsize = dotsize;
        this.i2caddress = i2caddress;
        this.backlight = MCP23008_BACKLIGHT;
        this.i2cbus = i2c.openSync(1); //just i2c bus 1 for now

        //set pins on MCP23008 to output
        this.i2cbus.writeByteSync(i2caddress, MCP23008_IODIR, 0); 
        // software reset set 4bit interface (page 46) send 4 bits 4 times.
        this.write4bits((LCD_FUNCTIONSET | LCD_8BITMODE) >> 1); //shift left 1 to fit into D7-D4 on MCP23008
        sleep.usleep(4100); //wait 4.1ms
        this.write4bits((LCD_FUNCTIONSET | LCD_8BITMODE) >> 1);
        sleep.usleep(100);  //wait 100μs
        this.write4bits((LCD_FUNCTIONSET | LCD_8BITMODE) >> 1); //Here we know for sure it's in 8bit mode
        this.write4bits((LCD_FUNCTIONSET | LCD_4BITMODE) >> 1); //Finally set 4bit mode. From here on we use 2x4bit writes.

        // Initialize display control, function, and mode registers.
        this.displaycontrol = LCD_DISPLAYON | LCD_CURSOROFF | LCD_BLINKOFF; //Put display on, cursor off, and blink off
        this.displayfunction = LCD_4BITMODE; //retain display in 4bit mode
        if (rows == 2) { 
            this.displayfunction |= LCD_2LINE; //set up 2 lines - 1 line is unset bit
        };
        if (dotsize == 10) {
            this.displayfunction |= LCD_5x10DOTS; //set up dotsize - 5x8 fornt is unset bit
        }
        this.displaymode = LCD_ENTRYLEFT | LCD_ENTRYSHIFTDECREMENT;
        // Write registers.
        this.writeCommand(LCD_DISPLAYCONTROL | 0); //turn off display
        this.writeCommand(LCD_FUNCTIONSET | this.displayfunction);
        this.writeCommand(LCD_ENTRYMODESET | this.displaymode);  // set the entry mode
        this.setCustomChars();
        this.clearDisplay();
        this.backlightOn();
        this.displayOn();
        //this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol); //turn on display
    }

    /* 
        timing - page 52 hd44780u for 5v values, 58 diagram. ms = millisec, μs=microsec
        
        data needs to be in bus before pulse ends
        Enable pulse with (high) = 230μs
        Minimum time between enable pulses = 500μs
        rest is neglible as the are fucken short (my claim)
        I do 250μs High and wait 250μs after - tight, but should be enough 
    */

    write4bits(bits) {
        // Pulse enable
        this.i2cbus.writeByteSync(this.i2caddress, MCP23008_GPIO, bits | MCP23008_ENABLE);
        sleep.usleep(250); 

        // End pulse enable
        this.i2cbus.writeByteSync(this.i2caddress, MCP23008_GPIO, bits);
        sleep.usleep(250);
    }

    write8bits(bits, isdata) {
        //write the bits out in two 4bit chunks

        // First chunk is top 4 bits shifted right to fit the data pins and we add backlight. The data register is 0b10
        this.write4bits( ( (bits >> 4) << MCP230XX_DATASHIFT) | this.backlight | (isdata << 1));
        //this.write4bits( ( (bits & 0xF0) >> 1) | this.backlight | (isdata << 1));

        // Second chunk is bottom 4 bits shifted left to fit the data pins and we add backlight. The data register is 0b10
        this.write4bits( ( (bits & 0x0F) << MCP230XX_DATASHIFT) | this.backlight | (isdata << 1) );
    }

    writeChar(char) {
        this.write8bits(this.translateChar(char), true);
        this.cursorColumn++;
    }

    writeCommand(command) {
        this.write8bits(command, false);
        sleep.usleep(40); //most commands take 37 μs at 270 kHz
    }

    writeString(string) {
        string = String(string);//this.translateNorwegianChars(String(string)); //why the cast??
        for (var i = 0; i < string.length; i++) {
            this.writeChar(string.charCodeAt(i));
        }
    }

    clearDisplay() {
        this.writeCommand(LCD_CLEARDISPLAY);
        this.cursorRow = 0;
        this.cursorColumn = 0;
        sleep.msleep(2); //no timing listed in manual, but I sometimes get garbage without.
    }

    returnHome() {
        this.writeCommand(LCD_RETURNHOME);
        //needs at least 1.52ms when osc is 270 kHz (page 24) we make room for a bit under 5v
        sleep.usleep(1600); 
    }

    cursorOn() {
        this.displaycontrol |= LCD_CURSORON;
        this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol);
    }

    cursorOff() {
        this.displaycontrol &= ~LCD_CURSORON;
        this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol);
    }

    blinkOn() {
        this.displaycontrol |= LCD_BLINKON;
        this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol);
    }

    blinkOff() {
        this.displaycontrol &= ~LCD_BLINKON;
        this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol);
    }


    setCursorPos(col, row) { //Row 1 starts at 0x00 ends at 0x27, row 2 starts at 0x40 ends at 0x67- where's the missing bytes???
        this.cursorColumn = col;
        this.cursorRow = row;
        this.writeCommand(LCD_SETDDRAMADDR | (row*0x40) | col);
    }

    shiftDisplayLeft() { //do cursor shift with display move right
        this.writeCommand(LCD_CURSORSHIFT| LCD_DISPLAYMOVE | LCD_MOVELEFT);
    }

    shiftDisplayRight() {
        this.writeCommand(LCD_CURSORSHIFT | LCD_DISPLAYMOVE | LCD_MOVERIGHT);
    }

    displayOff() { //Only turns off display drawing - won't affect backlight
        this.displaycontrol &= ~LCD_DISPLAYON; //take it off
        this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol);
    }

    displayOn() {
        this.displaycontrol |= LCD_DISPLAYON;
        this.writeCommand(LCD_DISPLAYCONTROL | this.displaycontrol);
    }

    backlightOn() {
        this.backlight = MCP23008_BACKLIGHT;
        this.writeCommand(0); //just write something to toggle the bit
    }

    backlightOff() {
        this.backlight = MCP23008_NOBACKLIGHT;
        this.writeCommand(0); //just write something to toggle the bit
    }

    setCustomChar(charnum, bits0 = 0, bits1 = 0, bits2 = 0, bits3 = 0, bits4 = 0, bits5 = 0, bits6 = 0, bits7 = 0) {
        //6bit adressing
        // for dotsize 8, top 3 bits are char (this means only 8 can be written), bottom 3 are lines
        // for dotsize 10, top 2 are char (this means only 4)
        this.writeCommand(LCD_SETCGRAMADDR | (charnum << 3)); //it will get incremented by one after each write
        this.write8bits(bits0, true);
        this.write8bits(bits1, true);
        this.write8bits(bits2, true);
        this.write8bits(bits3, true);
        this.write8bits(bits4, true);
        this.write8bits(bits5, true);
        this.write8bits(bits6, true);
        this.write8bits(bits7, true);
        this.setCursorPos(this.cursorColumn, this.cursorRow); //reset cursor for char output
    }

    setCustomChars() {
        this.setCustomChar(0, 0b01111, 0b10100, 0b10100, 0b11111, 0b10100, 0b10100, 0b10111, 0b00000); //Æ
        this.setCustomChar(1, 0b00001, 0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b01110, 0b10000); //Ø 
        this.setCustomChar(2, 0b00100, 0b01010, 0b00100, 0b01110, 0b10001, 0b11111, 0b10001, 0b00000); //Å 
        this.setCustomChar(3, 0b00000, 0b00000, 0b11010, 0b00101, 0b01111, 0b10100, 0b01111, 0b00000); //æ
        this.setCustomChar(4, 0b00000, 0b00001, 0b01110, 0b10011, 0b10101, 0b11001, 0b01110, 0b10000); //ø 
        this.setCustomChar(5, 0b00100, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111, 0b00000); //å 
    }

    translateChar(char) {
        switch (char) {
            case 198: // Æ
                char = 0;
                break;
            case 216: // Ø
                char = 1;
                break;
            case 197: // Å
                char = 2;
                break;
            case 230: //æ
                char = 3;
                break;
            case 248: //ø
                char = 4;
                break;
            case 229: //å
                char = 5;
                break;
            case 246: //ö
            case 214:
                char = 239;
                break;
            case 228: //ä
            case 196:
                char = 225;
                break;
        }
        return char;
    }

    finished() {
        this.displayOff();
        this.backlightOff();
    }

}

module.exports = MCP23008_CharLCD;