import { createApp } from './app.js';
import { CONFIG, type Config } from './config/config.js';

const app = await createApp();
const config = app.get<Config>(CONFIG);
await app.listen({ port: config.API_PORT, host: config.API_HOST });
