/* eslint-disable no-await-in-loop, no-console */

const fs = require('fs');
const { once } = require('events');
const { promisify } = require('util');

const sleep = promisify(setTimeout);

// register identifiers
const R_R0 = 0;
// const R_R1 = 1;
// const R_R2 = 2;
// const R_R3 = 3;
// const R_R4 = 4;
// const R_R5 = 5;
// const R_R6 = 6;
const R_R7 = 7;
const R_PC = 8; /* program counter */
const R_COND = 9;
// const R_COUNT = 10;

// opcode identifiers
const OP_BR = 0; /* branch */
const OP_ADD = 1; /* add */
const OP_LD = 2; /* load */
const OP_ST = 3; /* store */
const OP_JSR = 4; /* jump register */
const OP_AND = 5; /* bitwise and */
const OP_LDR = 6; /* load register */
const OP_STR = 7; /* store register */
// const OP_RTI = 8; /* unused */
const OP_NOT = 9; /* bitwise not */
const OP_LDI = 10; /* load indirect */
const OP_STI = 11; /* store indirect */
const OP_JMP = 12; /* jump */
// const OP_RES = 13; /* reserved (unused) */
const OP_LEA = 14; /* load effective address */
const OP_TRAP = 15; /* execute trap */

// condition flags
const FL_POS = 1; /* P - positive (1) */
const FL_ZRO = 1 << 1; /* Z - zero, (10) */
const FL_NEG = 1 << 2; /* N - negative (100) */

// trap codes
const TRAP_GETC = 0x20; /* get character from keyboard, not echoed onto the terminal */
const TRAP_OUT = 0x21; /* output a character */
const TRAP_PUTS = 0x22; /* output a word string */
const TRAP_IN = 0x23; /* get character from keyboard, echoed onto the terminal */
const TRAP_PUTSP = 0x24; /* output a byte string */
const TRAP_HALT = 0x25; /* halt the program */

// memory mapped registers
const MR_KBSR = 0xFE00; /* keyboard status */
const MR_KBDR = 0xFE02; /* keyboard data */

// contents of memory and registers
const memory = new Uint16Array(0xFFFF); // 65535 aka 2**16 memory locations
const registers = new Uint16Array(10);

// MEMORY ACCESS

const pollForKey = async function pollForKey() {
  let keyCode;
  const keyPromise = once(process.stdin, 'data');
  const sleepPromise = sleep(0);
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
      memory[MR_KBSR] = (1 << 15);
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

const signExtend = function signExtend(num, bitCount) {
  // if we shift the input bitCount-1 over and we have a 1 in the least significant bit,
  // that means that the number is a negative and ought to be filled with 1s instead of 0s
  if ((num >> (bitCount - 1)) & 1) {
    return num | (0xFFFF << bitCount);
  }
  return num;
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
    registers[R_COND] = FL_ZRO;
  } else if (register[register] >> 15 === 1) {
    registers[R_COND] = FL_NEG;
  } else {
    registers[R_COND] = FL_POS;
  }
};

// OPERATIONS

const add = function add(instr) {
  const destReg = (instr >> 9) & 0b111;
  const inputReg = (instr >> 6) & 0b111;
  const immFlag = (instr >> 5) & 0b1;
  if (immFlag) {
    const immValue = signExtend(instr & 0b11111, 5);
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
    const immValue = signExtend(instr & 0b11111, 5);
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
  const neg = (instr >> 11) & 0b1;
  const zero = (instr >> 10) & 0b1;
  const pos = (instr >> 9) & 0b1;
  const cond = registers[R_COND];
  const shouldBranch = (
    (neg && (cond === FL_NEG))
    || (zero && (cond === FL_ZRO))
    || (pos && (cond === FL_POS))
  );
  if (shouldBranch) {
    const offset = signExtend(instr & 0b111111111, 9);
    registers[R_PC] += offset;
  }
};

const jump = function jump(instr) {
  const baseRegister = (instr >> 6) & 0b111;
  registers[R_PC] = baseRegister;
};

const jumpToSubroutine = function jumpToSubroutine(instr) {
  registers[R_R7] = registers[R_PC];
  const offsetFlag = (instr >> 11) & 0b1;
  if (offsetFlag) {
    const offset = signExtend(instr & 0b11111111111, 11);
    registers[R_PC] += offset;
  } else {
    const baseRegister = (instr >> 6) & 0b111;
    registers[R_PC] = baseRegister;
  }
};

const load = async function load(instr) {
  const destReg = (instr >> 9) & 0b111;
  const offset = signExtend(instr & 0b111111111, 9);
  const addr = registers[R_PC] + offset;
  registers[destReg] = await readMemory(addr);
  updateCondFlag(destReg);
};

const loadIndirect = async function loadIndirect(instr) {
  const destReg = (instr >> 9) & 0b111;
  const loadOffset = signExtend(instr & 0b111111111, 9);
  const loadAddr = await readMemory(registers[R_PC] + loadOffset);
  registers[destReg] = await readMemory(loadAddr);
  updateCondFlag(destReg);
};

const loadWithOffset = async function loadWithOffset(instr) {
  const destReg = (instr >> 9) & 0b111;
  const baseRegister = (instr >> 6) & 0b111;
  const offset = signExtend(instr & 0b111111, 6);
  const addr = baseRegister + offset;
  registers[destReg] = await readMemory(addr);
  updateCondFlag(destReg);
};

const loadEffectiveAddress = async function loadEffectiveAddress(instr) {
  const destReg = (instr >> 9) & 0b111;
  const offset = signExtend(instr & 0b111111111, 9);
  const addr = registers[R_PC] + offset;
  registers[destReg] = await readMemory(addr);
  updateCondFlag(destReg);
};

const store = function store(instr) {
  const inputReg = (instr >> 9) & 0b111;
  const offset = signExtend(instr & 0b111111111, 9);
  const destAddr = registers[R_PC] + offset;
  writeMemory(destAddr, registers[inputReg]);
};

const storeIndirect = async function storeIndirect(instr) {
  const inputReg = (instr >> 9) & 0b111;
  const offset = signExtend(instr & 0b111111111, 9);
  const readAddr = registers[R_PC] + offset;
  const destAddr = await readMemory(readAddr);
  writeMemory(destAddr, registers[inputReg]);
};

const storeOffset = function storeOffset(instr) {
  const inputReg = (instr >> 9) & 0b111;
  const baseReg = (instr >> 6) & 0b111;
  const offset = signExtend(instr & 0b111111, 6);
  const destAddr = registers[baseReg] + offset;
  writeMemory(destAddr, registers[inputReg]);
};

// TRAP ROUTINES

const getChar = async function getInput() {
  const [key] = await once(process.stdin, 'data');
  return key[0];
};

const trapGetc = async function trapGetc() {
  const keyCode = await getChar();
  registers[R_R0] = keyCode;
};

const trapIn = async function trapIn() {
  // prompt for a character
  process.stdout.write('Enter a character: ');
  // get a character
  const keyCode = await getChar();
  // print that character to stdout
  process.stdout.write(String.fromCharCode(keyCode));
  // put that character in register 0
  registers[R_R0] = keyCode;
};

const trapOut = async function trapOut() {
  const character = await readMemory(registers[R_R0]);
  process.stdout.write(String.fromCharCode(character));
};

const trapPuts = async function trapPuts() {
  let addr = registers[R_R0];
  let character = await readMemory(addr);
  console.log(character);
  while (character) {
    process.stdout.write(String.fromCharCode(character));
    addr += 1;
    character = readMemory(addr);
  }
};

const trapPutsp = async function trapPutsp() {
  let addr = registers[R_R0];
  let characterPair = await readMemory(addr);
  while (characterPair) {
    const char1 = characterPair & 0xFF;
    process.stdout.write(String.fromCharCode(char1));
    const char2 = characterPair >> 8;
    if (char2) {
      process.stdout.write(String.fromCharCode(char2));
    }
    addr += 1;
    characterPair = await readMemory(addr);
  }
};

const main = async function main() {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (data) => {
    if (data[0] === 3) {
      process.exit(0);
    }
  });

  const filePath = './2048.obj';
  const obj = fs.readFileSync(filePath);
  let memLocation = obj.readUInt16BE(0);
  let offset = 2;
  while (offset < obj.length) {
    const word = obj.readUInt16BE(offset);
    writeMemory(memLocation, word);
    offset += 2;
    memLocation += 1;
  }

  const PC_START = 0x3000;
  registers[R_PC] = PC_START;

  let running = true;
  while (running) {
    const instruction = await readMemory(registers[R_PC]);
    const opcode = instruction >> 12; // Opcodes are located in bits [15:12] of an instruction
    registers[R_PC] += 1; // Increment the program counter after reading the instruction

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
        printAsHex(trapCode)
        switch (trapCode) {
          case TRAP_GETC: {
            await trapGetc();
            break;
          }
          case TRAP_HALT: {
            process.stdout.write('HALT');
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

  process.exit(0);
};

module.exports = {
  main,
  signExtend,
  printAsHex,
  printAsBinary,
  add,
};
