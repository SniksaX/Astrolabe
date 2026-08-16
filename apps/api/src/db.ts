import { Database } from '@astrolabe/db-core';
import { serverConfig } from './config.js';

/** Single shared pool for the whole process — every module borrows a scoped client via db-core's RLS helpers rather than opening its own pool. */
export const db = new Database(serverConfig.databaseUrl);
