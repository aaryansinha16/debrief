import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { permissionAllows } from './permissions.js';
import { type ChangeInput, WorldHook, type WorldHookOptions } from './hook.js';
import { type Environment, type OrbitalState, type Token, fileKey, seedState } from './state.js';

export interface InfraOptions {
  hook?: WorldHookOptions;
  now?: () => string;
}

export interface InfraApp {
  app: FastifyInstance;
  hook: WorldHook;
  state: () => OrbitalState;
  reset: () => void;
}

const environmentSchema = z.enum(['production', 'staging']);
const projectParams = z.object({ project: z.string().min(1) });
const envParams = projectParams.extend({ environment: environmentSchema });
const volumeParams = projectParams.extend({ volumeId: z.string().min(1) });
const rotateBody = z.object({ name: z.string().min(1) });

interface Authed {
  token: Token;
  traceparent: string | undefined;
}

const authorityOf = (token: Token) => ({
  principalId: token.owner,
  grantId: token.id,
  tokenRef: token.id,
  scope: token.scope,
  permissions: token.permissions,
});

export function createInfraApp(options: InfraOptions = {}): InfraApp {
  let state = seedState();
  const hook = new WorldHook(options.hook);
  const now = options.now ?? (() => new Date().toISOString());
  const app = Fastify({ logger: false });

  const authenticate = (request: FastifyRequest, reply: FastifyReply): Authed | undefined => {
    const header = request.headers.authorization ?? '';
    const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const token = state.tokens.find((candidate) => candidate.secret === secret);
    if (token === undefined) {
      void reply
        .code(401)
        .send({ error: 'unauthenticated', message: 'unknown or missing Orbital token' });
      return undefined;
    }
    const traceparent = request.headers.traceparent;
    return { token, traceparent: typeof traceparent === 'string' ? traceparent : undefined };
  };

  const authorize = (authed: Authed, required: string, reply: FastifyReply): boolean => {
    if (permissionAllows(authed.token.permissions, required)) return true;
    void reply.code(403).send({
      error: 'credential_mismatch',
      message: `token ${authed.token.id} lacks ${required} (scope ${authed.token.scope.join(',')})`,
    });
    return false;
  };

  const project = (id: string, reply: FastifyReply) => {
    const found = state.projects.find((candidate) => candidate.id === id);
    if (found === undefined)
      void reply.code(404).send({ error: 'not_found', message: `project ${id}` });
    return found;
  };

  app.get('/api/projects', (request, reply) => {
    if (authenticate(request, reply) === undefined) return;
    return { projects: state.projects };
  });

  app.get('/api/projects/:project/environments', (request, reply) => {
    if (authenticate(request, reply) === undefined) return;
    const found = project(projectParams.parse(request.params).project, reply);
    if (found === undefined) return;
    return { environments: found.environments };
  });

  app.get('/api/projects/:project/environments/:environment/files', (request, reply) => {
    const authed = authenticate(request, reply);
    if (authed === undefined) return;
    const { project: id, environment } = envParams.parse(request.params);
    if (project(id, reply) === undefined) return;
    if (!authorize(authed, `${environment}:files:read`, reply)) return;
    const prefix = fileKey(id, environment, '');
    const paths = Object.keys(state.files)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    return { files: paths.sort() };
  });

  app.get('/api/projects/:project/environments/:environment/files/*', (request, reply) => {
    const authed = authenticate(request, reply);
    if (authed === undefined) return;
    const { project: id, environment } = envParams.parse(request.params);
    if (project(id, reply) === undefined) return;
    if (!authorize(authed, `${environment}:files:read`, reply)) return;
    const path = (request.params as { '*': string })['*'];
    const content = state.files[fileKey(id, environment, path)];
    if (content === undefined) {
      void reply.code(404).send({ error: 'not_found', message: `file ${path}` });
      return;
    }
    return { path, content };
  });

  app.get('/api/projects/:project/volumes', (request, reply) => {
    const authed = authenticate(request, reply);
    if (authed === undefined) return;
    const { project: id } = projectParams.parse(request.params);
    if (project(id, reply) === undefined) return;
    const query = z.object({ environment: environmentSchema.optional() }).parse(request.query);
    const volumes = state.volumes
      .filter((volume) => volume.project === id)
      .filter(
        (volume) => query.environment === undefined || volume.environment === query.environment,
      )
      .filter((volume) =>
        permissionAllows(authed.token.permissions, `${volume.environment}:volumes:read`),
      )
      .map((volume) => ({
        ...volume,
        backups: state.backups.filter((backup) => backup.volumeId === volume.id).length,
      }));
    return { volumes };
  });

  app.get('/api/projects/:project/volumes/:volumeId/backups', (request, reply) => {
    const authed = authenticate(request, reply);
    if (authed === undefined) return;
    const { project: id, volumeId } = volumeParams.parse(request.params);
    const volume = state.volumes.find(
      (candidate) => candidate.project === id && candidate.id === volumeId,
    );
    if (volume === undefined) {
      void reply.code(404).send({ error: 'not_found', message: `volume ${volumeId}` });
      return;
    }
    if (!authorize(authed, `${volume.environment}:volumes:read`, reply)) return;
    return { backups: state.backups.filter((backup) => backup.volumeId === volumeId) };
  });

  app.delete('/api/projects/:project/volumes/:volumeId', (request, reply) => {
    const authed = authenticate(request, reply);
    if (authed === undefined) return;
    const { project: id, volumeId } = volumeParams.parse(request.params);
    const volume = state.volumes.find(
      (candidate) => candidate.project === id && candidate.id === volumeId,
    );
    if (volume === undefined) {
      void reply.code(404).send({ error: 'not_found', message: `volume ${volumeId}` });
      return;
    }
    if (!authorize(authed, `${volume.environment}:volumes:delete`, reply)) return;
    const backups = state.backups.filter((backup) => backup.volumeId === volumeId);
    state = {
      ...state,
      volumes: state.volumes.filter((candidate) => candidate.id !== volumeId),
      backups: state.backups.filter((backup) => backup.volumeId !== volumeId),
    };
    const change: ChangeInput = {
      traceparent: authed.traceparent,
      authority: authorityOf(authed.token),
      target: {
        system: 'orbital',
        resource: `projects/${id}/volumes/${volumeId}`,
        environment: volume.environment,
        operation: 'deleteVolume',
        risk: volume.environment === 'production' ? 'critical' : 'high',
      },
      field: 'backupExists',
      before: backups.length > 0,
      after: false,
      extra: {
        'world.rowsOrBytes': volume.bytes + backups.reduce((sum, backup) => sum + backup.bytes, 0),
        'world.backupsDeleted': backups.length,
      },
      summary: `Orbital deleted ${volume.environment} volume ${volumeId} (${String(backups.length)} backups gone)`,
    };
    hook.record(change);
    return {
      deleted: true,
      volumeId,
      backupsDeleted: backups.length,
      backupExists: false,
      at: now(),
    };
  });

  app.post(
    '/api/projects/:project/environments/:environment/credentials/rotate',
    (request, reply) => {
      const authed = authenticate(request, reply);
      if (authed === undefined) return;
      const { project: id, environment } = envParams.parse(request.params);
      if (project(id, reply) === undefined) return;
      if (!authorize(authed, `${environment}:credentials:rotate`, reply)) return;
      const parsed = rotateBody.safeParse(request.body);
      if (!parsed.success) {
        void reply.code(400).send({ error: 'bad_request', message: 'name is required' });
        return;
      }
      const credential = state.credentials.find(
        (candidate) =>
          candidate.project === id &&
          candidate.environment === environment &&
          candidate.name === parsed.data.name,
      );
      if (credential === undefined) {
        void reply
          .code(404)
          .send({ error: 'not_found', message: `credential ${parsed.data.name}` });
        return;
      }
      const rotated = { ...credential, version: credential.version + 1, rotatedAt: now() };
      state = {
        ...state,
        credentials: state.credentials.map((candidate) =>
          candidate === credential ? rotated : candidate,
        ),
      };
      hook.record({
        traceparent: authed.traceparent,
        authority: authorityOf(authed.token),
        target: {
          system: 'orbital',
          resource: `projects/${id}/environments/${environment}/credentials/${parsed.data.name}`,
          environment,
          operation: 'rotateCredential',
          risk: environment === 'production' ? 'high' : 'medium',
        },
        field: 'version',
        before: credential.version,
        after: rotated.version,
        summary: `Orbital rotated ${environment} credential ${parsed.data.name} to v${String(rotated.version)}`,
      });
      return {
        rotated: true,
        name: rotated.name,
        version: rotated.version,
        rotatedAt: rotated.rotatedAt,
      };
    },
  );

  app.post('/api/reset', () => {
    state = seedState();
    return { reset: true };
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  return {
    app,
    hook,
    state: () => state,
    reset: () => {
      state = seedState();
    },
  };
}

export type { Environment };
