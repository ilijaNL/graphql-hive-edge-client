import { createBatcher } from 'node-batcher';

export interface Report {
  size: number;
  map: OperationMap;
  operations: Operation[];
}

export interface OperationDefinition {
  key: string;
  operation: string;
  operationName?: string | null;
  fields: string[];
}

export interface ExecutionResult {
  ok: boolean;
  errors?: Array<{
    message: string;
    path?: Array<string>;
  }>;
}

interface Operation {
  operationMapKey: string;
  timestamp: number;
  execution: {
    duration: number;
    errorsTotal: number;
    ok: boolean;
    errors?: Array<{
      message: string;
      path?: string;
    }>;
  };
  metadata?: {
    client?: Partial<Client> | null;
  };
}

interface OperationMapRecord {
  operation: string;
  operationName?: string | null;
  fields: string[];
}

interface OperationMap {
  [key: string]: OperationMapRecord;
}

function randomSampling(sampleRate: number) {
  if (sampleRate > 1 || sampleRate < 0) {
    throw new Error(`Expected usage.sampleRate to be 0 <= x <= 1, received ${sampleRate}`);
  }

  return function shouldInclude(): boolean {
    return Math.random() <= sampleRate;
  };
}

export interface Client {
  name: string;
  version: string;
}

export interface UsageCollector {
  collect(def: OperationDefinition, client?: Partial<Client>): (result: ExecutionResult) => Promise<any>;
  dispose(): Promise<void>;
}

export type SendFn = (report: Report) => Promise<void>;

/**
 *  Creates a graphql-hive compatible send function. This is meant to be used when sending the reports to the hosted hive server.
 */
export const createHiveSendFn = (
  hiveToken: string,
  opts?: Partial<{
    clientName: string;
    endpoint: string;
  }>
): SendFn => {
  const clientName = opts?.clientName ?? 'hive-edge-client';
  return async (report) => {
    await fetch(opts?.endpoint ?? 'https://app.graphql-hive.com/usage', {
      method: 'POST',
      body: JSON.stringify(report),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${hiveToken}`,
        'User-Agent': `${clientName}/0.0.1`,
        'graphql-client-name': clientName,
        'graphql-client-version': '0.0.1',
      },
      keepalive: true,
    });
  };
};

export function createUsageCollector(options: {
  send: SendFn;
  sampleRate?: number;
  /**
   * Send reports in interval (defaults to 5_000ms)
   */
  sendInterval?: number;
  /**
   * Max number of traces to send at once (defaults to 25)
   */
  maxSize?: number;
}): UsageCollector {
  const batcher = createBatcher<{
    state: OperationDefinition;
    execution: Report['operations'][number]['execution'];
    client?: Partial<Client>;
  }>({
    maxSize: options.maxSize ?? 25,
    genId: () => globalThis.crypto.randomUUID(),
    maxTimeInMs: options.sendInterval ?? 5_000,
    async onFlush(items) {
      const report: Report = {
        map: {},
        operations: new Array(items.length),
        size: items.length,
      };

      const now = Date.now();

      items.forEach((item, idx) => {
        const state = item.data.state;
        report.operations[idx] = {
          operationMapKey: state.key,
          timestamp: now - item.delta_ms,
          execution: item.data.execution,
          metadata: {
            client: item.data.client,
          },
        };

        if (!report.map[state.key]) {
          report.map[state.key] = {
            operation: state.operation,
            operationName: state.operationName,
            fields: state.fields,
          };
        }
      });

      await options.send(report);
    },
  });

  const shouldInclude = randomSampling(options.sampleRate ?? 1.0);

  return {
    collect(state, client) {
      const started_at = Date.now();
      return async function complete(result) {
        if (!shouldInclude) {
          return;
        }
        const now = Date.now();
        const errors =
          result.errors?.map((error) => ({
            message: error.message,
            path: error.path?.join('.'),
          })) ?? [];
        const durationInMs = now - started_at;
        return batcher
          .add({
            execution: {
              ok: result.ok && errors.length === 0,
              duration: durationInMs * 1_000_000,
              errorsTotal: errors.length,
              errors: errors,
            },
            state: state,
            client: client,
          })
          .catch((e) => {
            // catch the error
            // eslint-disable-next-line no-console
            console.error(e);
          });
      };
    },
    dispose() {
      return batcher.waitForAll();
    },
  };
}
