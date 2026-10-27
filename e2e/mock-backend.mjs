import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const parsedPort = parseInt(process.env.MOCK_BACKEND_PORT || '3081', 10);
const PORT = Number.isNaN(parsedPort) ? 3081 : parsedPort;
const ADMIN_PANEL_URL = process.env.MOCK_ADMIN_PANEL_URL || 'http://localhost:3000';

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', () => resolve({}));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

const VALID_TEMP_TOKEN = 'valid-2fa-temp-token-for-testing';

/** The PKCE challenge each one-time exchange code was issued for, as LibreChat binds them. */
const exchangeChallenges = new Map();

/**
 * LibreChat's admin OAuth start route, with the identity provider signing the
 * admin in at once: back to the panel's callback with a one-time code.
 */
function startAdminOAuth(provider) {
  return (_body, req) => {
    const challenge = new URL(req.url, 'http://mock').searchParams.get('code_challenge');
    const code = randomBytes(32).toString('hex');
    exchangeChallenges.set(code, challenge);
    return [302, {}, { Location: `${ADMIN_PANEL_URL}/auth/${provider}/callback?code=${code}` }];
  };
}

const FEDERATED_LOGIN_BLOCKED = [
  403,
  {
    code: 'TWO_FACTOR_FEDERATED_LOGIN_BLOCKED',
    message: 'Sign in with your identity provider to continue.',
  },
];

const handlers = {
  'POST /api/admin/login/local': (body, req) => {
    if (body.email === 'rejected@test.com') return [404, { message: 'Incorrect password.' }];
    if (body.email === 'unverified@test.com') return [422, { message: 'Email not verified.' }];
    if (body.email === 'member@test.com') return [403, { message: 'Forbidden', code: 'FORBIDDEN' }];
    if (body.email === 'federated@test.com') return FEDERATED_LOGIN_BLOCKED;
    if (body.email === 'tenant@test.com' && req.headers['x-tenant-id'] !== 'tenant-a')
      return [
        403,
        {
          message: 'Tenant context required in strict isolation mode',
          code: 'TENANT_CONTEXT_REQUIRED',
        },
      ];
    if (body.email === '2fa@test.com')
      return [200, { twoFAPending: true, tempToken: VALID_TEMP_TOKEN }];
    return [
      200,
      {
        token: 'test-admin-token',
        user: {
          id: 'u_test',
          email: body.email,
          name: 'Test Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'POST /api/auth/2fa/verify-temp': (body) => {
    if (body.tempToken !== VALID_TEMP_TOKEN)
      return [401, { message: 'Invalid or expired temporary token' }];
    if (body.token === '000000') return [401, { message: 'Invalid 2FA code or backup code' }];
    if (body.token === '111111') return FEDERATED_LOGIN_BLOCKED;
    return [
      200,
      {
        token: 'test-admin-token-2fa',
        user: {
          id: 'u_2fa',
          email: '2fa@test.com',
          name: '2FA Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'GET /api/admin/verify': (_body, req) => {
    const auth = req?.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return [401, { error: 'Authentication required' }];
    const token = auth.slice('Bearer '.length);
    if (token !== 'test-admin-token' && token !== 'test-admin-token-2fa')
      return [401, { error: 'Invalid or expired token' }];
    return [
      200,
      {
        user: {
          id: 'u_test',
          email: 'admin@test.com',
          name: 'Test Admin',
          role: 'ADMIN',
        },
      },
    ];
  },
  'GET /api/admin/oauth/openid/check': () => [200, { message: 'OpenID check successful' }],
  'GET /api/config': () => [
    200,
    {
      socialLoginEnabled: true,
      socialLogins: ['google', 'openid', 'saml'],
      googleLoginEnabled: true,
      openidLoginEnabled: true,
      openidLabel: 'Continue with OpenID',
      samlLoginEnabled: false,
    },
  ],
  'GET /api/admin/oauth/openid': startAdminOAuth('openid'),
  'GET /api/admin/oauth/google': startAdminOAuth('google'),
  'POST /api/admin/oauth/exchange': (body) => {
    const challenge = exchangeChallenges.get(body.code);
    exchangeChallenges.delete(body.code);
    const verified =
      typeof challenge === 'string' &&
      typeof body.code_verifier === 'string' &&
      createHash('sha256').update(body.code_verifier).digest('hex') === challenge;
    if (!verified)
      return [
        401,
        { error: 'Invalid or expired authorization code', error_code: 'INVALID_OR_EXPIRED_CODE' },
      ];
    return [
      200,
      {
        token: 'test-admin-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 15 * 60 * 1000,
        user: { id: 'u_test', email: 'admin@test.com', name: 'Test Admin', role: 'ADMIN' },
      },
    ];
  },
};

const server = createServer(async (req, res) => {
  const path = req.url?.split('?')[0];
  const key = `${req.method} ${path}`;
  const handler = handlers[key];

  let status = 404;
  let body = { error: 'not found' };
  let headers = {};

  if (handler) {
    const reqBody = req.method === 'POST' ? await parseBody(req) : {};
    [status, body, headers = {}] = handler(reqBody, req);
  }

  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`Mock backend listening on http://localhost:${PORT}`);
});
