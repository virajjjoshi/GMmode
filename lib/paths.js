// Where runtime data lives. Point DATA_DIR at a persistent disk in production
// (e.g. a Fly volume or Render disk mounted at /data).
const path = require('node:path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const dataFile = (name) => path.join(DATA_DIR, name);

module.exports = { DATA_DIR, dataFile };
