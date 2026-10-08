import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { reconstructRoutes } from './routes.ts';

const TREE = `└── /
    ├── probe (GET, HEAD)
    ├── api/
    │   ├── auth/
    │   │   ├── login (GET, HEAD)
    │   │   ├── callback (GET, HEAD)
    │   │   └── s
    │   │       ├── tep-up (POST)
    │   │       └── ign-out-others (POST)
    │   ├── members/
    │   │   ├── invit
    │   │   │   ├── e (POST)
    │   │   │   └── ations/
    │   │   │       └── :id
    │   │   │           └── /revoke (POST)
    │   │   ├── disable (POST)
    │   │   ├── remove (POST)
    │   │   └── transfer-ownership (POST)
    │   ├── support/grants (POST, GET, HEAD)
    │   │   └── /
    │   │       └── :id
    │   │           └── /revoke (POST)
    │   └── recovery/
    │       ├── disable-user (POST)
    │       ├── enable-user (POST)
    │       └── revoke-sessions (POST)
    ├── healthz (GET, HEAD)
    ├── readyz (GET, HEAD)
    └── voice/
        ├── inbound (POST)
        ├── session-end (POST)
        └── relay (GET, HEAD)`;

describe('reconstructRoutes', () => {
  evidenceTest('rebuilds every served route from the printed tree', () => {
    expect([...reconstructRoutes(TREE)].sort()).toStrictEqual(
      [
        'GET /probe',
        'GET /api/auth/login',
        'GET /api/auth/callback',
        'POST /api/auth/step-up',
        'POST /api/auth/sign-out-others',
        'POST /api/members/invite',
        'POST /api/members/invitations/:id/revoke',
        'POST /api/members/disable',
        'POST /api/members/remove',
        'POST /api/members/transfer-ownership',
        'POST /api/support/grants',
        'GET /api/support/grants',
        'POST /api/support/grants/:id/revoke',
        'POST /api/recovery/disable-user',
        'POST /api/recovery/enable-user',
        'POST /api/recovery/revoke-sessions',
        'GET /healthz',
        'GET /readyz',
        'POST /voice/inbound',
        'POST /voice/session-end',
        'GET /voice/relay',
      ].sort(),
    );
  });
});
