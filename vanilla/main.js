/* eslint-disable no-await-in-loop, no-console, no-unused-vars */

const { once } = require('events');
const { promisify } = require('util');

const sleep = promisify(setTimeout);

// registers
const R0 = 0;
const R1 = 1;
const R2 = 2;
const R3 = 3;
const R4 = 4;
const R5 = 5;
const R6 = 6;
const R7 = 7;
const PC = 8; /* program counter */
const COND = 9;
const COUNT = 10;

// opcodes
const OP_BR = 0; /* branch */
const OP_ADD = 1; /* add */
const OP_LD = 2; /* load */
const OP_ST = 3; /* store */
const OP_JSR = 4; /* jump to subroutine */
const OP_AND = 5; /* bitwise and */
const OP_LDR = 6; /* load with offset */
const OP_STR = 7; /* store with offset */
const OP_RTI = 8; /* unused */
const OP_NOT = 9; /* bitwise not */
const OP_LDI = 10; /* load indirect */
const OP_STI = 11; /* store indirect */
const OP_JMP = 12; /* jump */
const OP_RES = 13; /* reserved (unused) */
const OP_LEA = 14; /* load effective address */
const OP_TRAP = 15; /* execute trap */

// condition flags
const FL_POS = 0b1; /* P - positive */
const FL_ZRO = 0b10; /* Z - zero */
const FL_NEG = 0b100; /* N - negative */

// trap codes
const TRAP_GETC = 0x20; /* get character from keyboard, not echoed onto the terminal */
const TRAP_OUT = 0x21; /* output a character */
const TRAP_PUTS = 0x22; /* output a word string */
const TRAP_IN = 0x23; /* get character from keyboard, echoed onto the terminal */
const TRAP_PUTSP = 0x24; /* output a byte string */
const TRAP_HALT = 0x25; /* halt the program */

// memory mapped registers
const MR_KBSR = 0xfe00; /* keyboard status */
const MR_KBDR = 0xfe02; /* keyboard data */

// contents of memory and registers
const memory = new Uint16Array(0xffff); // 65535 aka 2**16 memory locations
const registers = new Uint16Array(10);

// MEMORY ACCESS

const pollForKey = async function pollForKey() {
  let keyCode;
  const keyPromise = once(process.stdin, 'data');
  const sleepPromise = sleep(5);
  const key = await Promise.race([keyPromise, sleepPromise]);
  if (key) {
    [[keyCode]] = key;
  }
  const listeners = process.stdin.rawListeners('data');
  listeners.forEach((listenerFunc) => {
    if (listenerFunc.listener) {
      process.stdin.removeListener('data', listenerFunc.listener);
    }
  });
  process.stdin.removeAllListeners('error');
  return keyCode;
};

const readMemory = async function readMemory(address) {
  if (address === MR_KBSR) {
    const keyCode = await pollForKey();
    if (keyCode) {
      memory[MR_KBSR] = 0x8000;
      memory[MR_KBDR] = keyCode;
    } else {
      memory[MR_KBSR] = 0;
    }
  }
  return memory[address];
};

const writeMemory = function writeMemory(address, value) {
  memory[address] = value;
};

// UTILITIES

const signExtendSuffix = function signExtendSuffix(instr, inputBitWidth) {
  const mask = (1 << inputBitWidth) - 1;
  const suffix = instr & mask;
  if ((suffix >> (inputBitWidth - 1)) & 1) {
    // This condition checks the value of the first bit in the suffix. If it's a '1'
    // that means that the value we're extending is negative and we need to extend it
    // with '1's. If it isn't negative, then we don't need to do anything to it
    const extended = suffix | (0xffff << inputBitWidth);
    return extended & 0xffff;
  }
  return suffix;
};

const printAsHex = function printAsHex(num) {
  const hex = num.toString(16);
  console.log(hex.padStart(4, '0'));
};

const printAsBinary = function printAsBinary(num) {
  const binary = num.toString(2);
  const padded = binary.padStart(16, '0');
  const ret = [];
  for (let offset = 0; offset < 16; offset += 4) {
    ret.push(padded.slice(offset, offset + 4));
  }
  console.log(ret.join(' '));
};

const updateCondFlag = function updateCondFlag(register) {
  if (registers[register] === 0) {
    registers[COND] = FL_ZRO;
  } else if (registers[register] >> 15 === 1) {
    registers[COND] = FL_NEG;
  } else {
    registers[COND] = FL_POS;
  }
};

// OPERATIONS

const add = function add(instr) {
  const destReg = (instr >> 9) & 0b111;
  const inputReg = (instr >> 6) & 0b111;
  const immFlag = (instr >> 5) & 0b1;
  if (immFlag) {
    const immValue = signExtendSuffix(instr, 5);
    registers[destReg] = registers[inputReg] + immValue;
  } else {
    const secondInputReg = instr & 0b111;
    registers[destReg] = registers[inputReg] + registers[secondInputReg];
  }
  updateCondFlag(destReg);
};

const and = function and(instr) {
  const destReg = (instr >> 9) & 0b111;
  const inputReg = (instr >> 6) & 0b111;
  const immFlag = (instr >> 5) & 0b1;
  if (immFlag) {
    const immValue = signExtendSuffix(instr, 5);
    registers[destReg] = registers[inputReg] & immValue;
  } else {
    const secondInputReg = instr & 0b111;
    registers[destReg] = registers[inputReg] & registers[secondInputReg];
  }
  updateCondFlag(destReg);
};

const not = function not(instr) {
  const destReg = (instr >> 9) & 0b111;
  const inputReg = (instr >> 6) & 0b111;
  registers[destReg] = ~registers[inputReg];
  updateCondFlag(destReg);
};

const branch = function branch(instr) {
  const condMask = (instr >> 9) & 0b111;
  const condFlag = registers[COND];
  const shouldBranch = (condMask & condFlag);
  if (shouldBranch) {
    const offset = signExtendSuffix(instr, 9);
    const newPC = (registers[PC] + offset) & 0xffff;
    registers[PC] = newPC;
  }
};

const jump = function jump(instr) {
  const baseRegister = (instr >> 6) & 0b111;
  registers[PC] = registers[baseRegister];
};

const jumpToSubroutine = function jumpToSubroutine(instr) {
  registers[R7] = registers[PC];
  const offsetFlag = (instr >> 11) & 0b1;
  if (offsetFlag === 1) {
    const offset = signExtendSuffix(instr, 11);
    const newPC = (registers[PC] + offset) & 0xffff;
    registers[PC] = newPC;
  } else {
    const baseRegister = (instr >> 6) & 0b111;
    registers[PC] = registers[baseRegister];
  }
};

const load = async function load(instr) {
  const destReg = (instr >> 9) & 0b111;
  const offset = signExtendSuffix(instr, 9);
  const addr = (registers[PC] + offset) & 0xffff;
  registers[destReg] = await readMemory(addr);
  updateCondFlag(destReg);
};

const loadIndirect = async function loadIndirect(instr) {
  const destReg = (instr >> 9) & 0b111;
  const loadOffset = signExtendSuffix(instr, 9);
  const addr = (registers[PC] + loadOffset) & 0xffff;
  const loadAddr = await readMemory(addr);
  const loadVal = await readMemory(loadAddr);
  registers[destReg] = loadVal;
  updateCondFlag(destReg);
};

const loadWithOffset = async function loadWithOffset(instr) {
  const destReg = (instr >> 9) & 0b111;
  const baseRegister = (instr >> 6) & 0b111;
  const offset = signExtendSuffix(instr, 6);
  const addr = (registers[baseRegister] + offset) & 0xffff;
  registers[destReg] = await readMemory(addr);
  updateCondFlag(destReg);
};

const loadEffectiveAddress = async function loadEffectiveAddress(instr) {
  const destReg = (instr >> 9) & 0b111;
  const offset = signExtendSuffix(instr, 9);
  registers[destReg] = (registers[PC] + offset) & 0xffff;
  updateCondFlag(destReg);
};

const store = function store(instr) {
  const inputReg = (instr >> 9) & 0b111;
  const offset = signExtendSuffix(instr, 9);
  const destAddr = (registers[PC] + offset) & 0xffff;
  writeMemory(destAddr, registers[inputReg]);
};

const storeIndirect = async function storeIndirect(instr) {
  const inputReg = (instr >> 9) & 0b111;
  const offset = signExtendSuffix(instr, 9);
  const readAddr = (registers[PC] + offset) & 0xffff;
  const destAddr = await readMemory(readAddr);
  writeMemory(destAddr, registers[inputReg]);
};

const storeOffset = function storeOffset(instr) {
  const regToStore = (instr >> 9) & 0b111;
  const baseReg = (instr >> 6) & 0b111;
  const offset = signExtendSuffix(instr, 6);
  const destAddr = (registers[baseReg] + offset) & 0xffff;
  writeMemory(destAddr, registers[regToStore]);
};

// TRAP ROUTINES

const getChar = async function getInput() {
  const [key] = await once(process.stdin, 'data');
  return key[0];
};

const trapGetc = async function trapGetc() {
  const keyCode = await getChar();
  registers[R0] = keyCode;
};

const trapIn = async function trapIn() {
  process.stdout.write('Enter a character: ');
  const keyCode = await getChar();
  process.stdout.write(String.fromCharCode(keyCode));
  registers[R0] = keyCode;
};

const trapOut = async function trapOut() {
  const character = registers[R0];
  process.stdout.write(String.fromCharCode(character));
};

const trapPuts = async function trapPuts() {
  let addr = registers[R0];
  let character = await readMemory(addr);
  while (character !== 0x0000) {
    process.stdout.write(String.fromCharCode(character));
    addr += 1;
    character = await readMemory(addr);
  }
};

const trapPutsp = async function trapPutsp() {
  let addr = registers[R0];
  let characterPair = await readMemory(addr);
  while (characterPair !== 0x0000) {
    const char1 = characterPair & 0xff;
    process.stdout.write(String.fromCharCode(char1));
    const char2 = characterPair >> 8;
    if (char2 !== 0x00) {
      process.stdout.write(String.fromCharCode(char2));
    }
    addr += 1;
    characterPair = await readMemory(addr);
  }
};

// MAIN LOOP

const run = async function run(programBuffer) {
  // We need to set the terminal into raw mode to capture individual keypresses rather than
  // buffering them. Because we're in raw mode, we need to detect command-C manually
  process.stdin.setRawMode(true);
  process.stdin.on('data', (data) => {
    if (data[0] === 3) {
      process.exit(0);
    }
  });

  // LC-3 programs are big-endian. Since node Uint16Arrays are little-endian, we can use
  // readUInt16BE to read pairs of bytes and flip them from big-endian to little-endian,
  // before writing them to memory sequentially.
  let memLocation = programBuffer.readUInt16BE(0);
  let offset = 2;
  while (offset < programBuffer.length) {
    const word = programBuffer.readUInt16BE(offset);
    writeMemory(memLocation, word);
    offset += 2;
    memLocation += 1;
  }

  registers[PC] = 0x3000; // LC-3 programs always start the program counter at this address

  let running = true;
  while (running) {
    const instruction = await readMemory(registers[PC]);
    const opcode = instruction >> 12; // Opcodes are located in bits [15:12] of an instruction
    registers[PC] += 1; // LC-3 increments the program counter after reading each instruction

    switch (opcode) {
      case OP_ADD: {
        add(instruction);
        break;
      }
      case OP_AND: {
        and(instruction);
        break;
      }
      case OP_NOT: {
        not(instruction);
        break;
      }
      case OP_BR: {
        branch(instruction);
        break;
      }
      case OP_JMP: {
        jump(instruction);
        break;
      }
      case OP_JSR: {
        jumpToSubroutine(instruction);
        break;
      }
      case OP_LD: {
        await load(instruction);
        break;
      }
      case OP_LDI: {
        await loadIndirect(instruction);
        break;
      }
      case OP_LDR: {
        await loadWithOffset(instruction);
        break;
      }
      case OP_LEA: {
        await loadEffectiveAddress(instruction);
        break;
      }
      case OP_ST: {
        store(instruction);
        break;
      }
      case OP_STI: {
        await storeIndirect(instruction);
        break;
      }
      case OP_STR: {
        storeOffset(instruction);
        break;
      }
      case OP_TRAP: {
        const trapCode = instruction & 0xFF;
        switch (trapCode) {
          case TRAP_GETC: {
            await trapGetc();
            break;
          }
          case TRAP_HALT: {
            running = false;
            break;
          }
          case TRAP_IN: {
            await trapIn();
            break;
          }
          case TRAP_OUT: {
            await trapOut();
            break;
          }
          case TRAP_PUTS: {
            await trapPuts();
            break;
          }
          case TRAP_PUTSP: {
            await trapPutsp();
            break;
          }
          default: {
            break;
          }
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  // Easiest way to clean up any dangling event listeners that keep the node process running
  // is to just force an exit – if the main loop isn't running anymore we can be confident
  // the program is finished
  process.exit(0);
};

module.exports = {
  run,
};
