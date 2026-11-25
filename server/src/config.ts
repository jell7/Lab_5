import path from 'node:path';
import { z } from 'zod';

const EnvConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_DIR: z.string().min(1).default(path.resolve(process.cwd(), 'logs')),
  TICK_RATE: z.coerce.number().int().min(10).max(120).default(30),
});

export type ServerConfig = z.infer<typeof EnvConfigSchema>;

export const config: ServerConfig = EnvConfigSchema.parse(process.env);