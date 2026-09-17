import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { OrbitalClient, type OrbitalResult } from './orbital-client.js';

const environmentSchema = z.enum(['production', 'staging']).describe('Orbital environment');
const tokenSchema = z
  .string()
  .regex(/^orb_(live|test)_[A-Za-z0-9]+$/)
  .optional()
  .describe('Orbital token to use instead of the configured one');

interface ToolExtra {
  _meta?: { traceparent?: unknown };
}

const traceparentOf = (extra: ToolExtra): string | undefined => {
  const value = extra._meta?.traceparent;
  return typeof value === 'string' ? value : undefined;
};

function toResult(result: OrbitalResult): CallToolResult {
  const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
  if (result.status >= 400) {
    const message =
      typeof result.body === 'object' && result.body !== null && 'message' in result.body
        ? String(result.body.message)
        : text;
    return {
      isError: true,
      content: [{ type: 'text', text: `Orbital ${String(result.status)}: ${message}` }],
    };
  }
  return { content: [{ type: 'text', text }] };
}

export function createOrbitalMcpServer(client: OrbitalClient): McpServer {
  const server = new McpServer({ name: 'orbital-mcp', version: '0.1.0' });

  server.registerTool(
    'readFile',
    {
      title: 'Read a file',
      description: 'Read a file from a project environment on Orbital',
      inputSchema: {
        project: z.string(),
        environment: environmentSchema,
        path: z.string(),
        token: tokenSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project, environment, path, token }, extra) => {
      const result = await client.call({
        method: 'GET',
        path: `/api/projects/${encodeURIComponent(project)}/environments/${environment}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
        token,
        traceparent: traceparentOf(extra as ToolExtra),
      });
      if (
        result.status < 400 &&
        typeof result.body === 'object' &&
        result.body !== null &&
        'content' in result.body
      ) {
        return {
          content: [{ type: 'text', text: String(result.body.content) }],
        };
      }
      return toResult(result);
    },
  );

  server.registerTool(
    'listVolumes',
    {
      title: 'List volumes',
      description: 'List the volumes of a project, optionally filtered by environment',
      inputSchema: {
        project: z.string(),
        environment: environmentSchema.optional(),
        token: tokenSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project, environment, token }, extra) => {
      const query = environment === undefined ? '' : `?environment=${environment}`;
      return toResult(
        await client.call({
          method: 'GET',
          path: `/api/projects/${encodeURIComponent(project)}/volumes${query}`,
          token,
          traceparent: traceparentOf(extra as ToolExtra),
        }),
      );
    },
  );

  server.registerTool(
    'deleteVolume',
    {
      title: 'Delete a volume',
      description: 'Delete a volume and its backups. Destructive and irreversible.',
      inputSchema: { project: z.string(), volumeId: z.string(), token: tokenSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ project, volumeId, token }, extra) =>
      toResult(
        await client.call({
          method: 'DELETE',
          path: `/api/projects/${encodeURIComponent(project)}/volumes/${encodeURIComponent(volumeId)}`,
          token,
          traceparent: traceparentOf(extra as ToolExtra),
        }),
      ),
  );

  server.registerTool(
    'rotateCredential',
    {
      title: 'Rotate a credential',
      description: 'Rotate a named credential in a project environment',
      inputSchema: {
        project: z.string(),
        environment: environmentSchema,
        name: z.string(),
        token: tokenSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ project, environment, name, token }, extra) =>
      toResult(
        await client.call({
          method: 'POST',
          path: `/api/projects/${encodeURIComponent(project)}/environments/${environment}/credentials/rotate`,
          token,
          traceparent: traceparentOf(extra as ToolExtra),
          body: { name },
        }),
      ),
  );

  return server;
}
