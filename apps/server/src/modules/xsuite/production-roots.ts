/**
 * Loads the two production root modules the cross-tenant suite measures against.
 *
 * `ConfigModule.forFeature()` reads the environment when the root module file is evaluated, and
 * each role validates a different set of variables. So the roots are imported one at a time under
 * the minimum fake configuration each role accepts, and the environment is restored afterwards.
 * Nothing here connects to anything: the point is the decorator metadata, not a running app.
 */

import type { Type } from '@nestjs/common';

const COMMON = {
  DATABASE_URL: 'postgres://xsuite:xsuite@127.0.0.1:1/xsuite',
  AUTH_LOCAL_TOKEN_KEY: 'local-v1:local-development-only',
  APP_ORIGIN: 'http://localhost:3000',
};

const ROLE_ENV: Record<'api' | 'voice', Record<string, string>> = {
  api: { SERVER_ROLE: 'api', ...COMMON },
  voice: {
    SERVER_ROLE: 'voice',
    ...COMMON,
    TWILIO_AUTH_TOKEN: 'a'.repeat(32),
    VOICE_PUBLIC_ORIGIN: 'https://voice.example.test',
    VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.test',
  },
};

async function underEnv<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const before = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await body();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

export async function loadProductionRoots(): Promise<{
  readonly api: Type;
  readonly voice: Type;
}> {
  const api = await underEnv(ROLE_ENV.api, async () => {
    const mod = await import('../../roots/api-root.module.ts');
    return mod.ApiRootModule;
  });
  const voice = await underEnv(ROLE_ENV.voice, async () => {
    const mod = await import('../../roots/voice-root.module.ts');
    return mod.VoiceRootModule;
  });
  return { api, voice };
}
