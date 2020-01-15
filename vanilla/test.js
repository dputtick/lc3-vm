const vm = require('./main');

/* const helloWorld = `
.ORIG x3000                        ; this is the address in memory where the program will be loaded
LEA R0, HELLO_STR                  ; load the address of the HELLO_STR string into R0
PUTs                               ; output the string pointed to by R0 to the console
HALT                               ; halt the program
HELLO_STR .STRINGZ "Hello World!"  ; store this string here in the program
.END
`; */

test('signExtend', () => {
  expect(vm.signExtend(1, 5)).toBe(1);
  expect(vm.signExtend(-1, 5)).toBe(-1);
});

// test('printAsHex', () => {
//   vm.printAsHex(444);
// });

// test('printAsBinary', () => {
//   vm.printAsBinary(0xFFFF);
// });

test('add', () => {
  vm.add(0b0001001010000011);
});
