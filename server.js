import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/yc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.all('/api/yc', async (req, res) => {
  return handler(req, res);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
