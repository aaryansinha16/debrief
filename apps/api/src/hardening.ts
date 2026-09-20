import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const BODY_LIMIT_BYTES = 8 * 1024 * 1024;
// Everything that is not a trace or event batch is a small JSON document (a policy, a name, a job request).
export const SMALL_BODY_LIMIT_BYTES = 256 * 1024;
export const INGEST_ROUTES: ReadonlySet<string> = new Set(['/v1/traces', '/v1/events']);

// OWASP secure headers for an API that serves JSON and one signed key set; nothing here is a document a browser should render.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
};

export function bodyLimitFor(route: string | undefined): number {
  return route !== undefined && INGEST_ROUTES.has(route)
    ? BODY_LIMIT_BYTES
    : SMALL_BODY_LIMIT_BYTES;
}

export function applyHardening(fastify: FastifyInstance): void {
  fastify.addHook('onSend', (_request: FastifyRequest, reply: FastifyReply, payload, done) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) void reply.header(name, value);
    }
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    done(null, payload);
  });
  fastify.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done) => {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > bodyLimitFor(request.routeOptions.url)) {
      void reply.status(413).send({ statusCode: 413, message: 'request body too large' });
      return;
    }
    done();
  });
}
