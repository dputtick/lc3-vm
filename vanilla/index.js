const fs = require('fs');

const vm = require('./vm');

const filePath = './2048.obj';
const obj = fs.readFileSync(filePath);
vm.run(obj);
