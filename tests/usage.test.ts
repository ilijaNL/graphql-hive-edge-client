/* eslint-disable @typescript-eslint/ban-ts-comment */
import { test } from 'tap';
import { randomUUID } from 'node:crypto';
import { createUsageCollector } from '../src';
import EventEmitter, { once } from 'node:events';

// polyfill for nodejs env
// @ts-ignore
globalThis.crypto = { randomUUID };

test('correctly format errors', async (t) => {
  t.plan(3);
  const usageColl = createUsageCollector({
    sendInterval: 10,
    send: async (r) => {
      t.same(r.size, 1);
      t.same(r.map.abc?.operation, 'query me {}');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      t.has(r.operations[0]?.execution, {
        ok: false,
        errorsTotal: 1,
        errors: [
          {
            message: 'abc',
            path: 'a.b',
          },
        ],
      });
    },
  });

  const finish = usageColl.collect({
    fields: ['fieldA'],
    key: 'abc',
    operation: 'query me {}',
    operationName: 'opName',
  });

  await finish({
    ok: false,
    errors: [{ message: 'abc', path: ['a', 'b'] }],
  });
});

test('correctly set ok status', async (t) => {
  t.plan(1);
  const usageColl = createUsageCollector({
    sendInterval: 10,
    send: async (r) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      t.has(r.operations[0]?.execution, {
        ok: false,
        errorsTotal: 1,
        errors: [
          {
            message: 'abc',
            path: 'a.b',
          },
        ],
      });
    },
  });

  const finish = usageColl.collect({
    fields: ['fieldA'],
    key: 'abc',
    operation: 'query me {}',
    operationName: 'opName',
  });

  await finish({
    ok: true,
    errors: [{ message: 'abc', path: ['a', 'b'] }],
  });
});

test('correctly creates map operation', async (t) => {
  t.plan(3);
  const usageColl = createUsageCollector({
    sendInterval: 20,
    send: async (r) => {
      t.has(r.map, {
        abc: {
          operation: 'query me {}',
          operationName: 'opName',
          fields: ['fieldA'],
        },
      });
      t.has(r.operations[0]?.execution, {
        ok: false,
        errorsTotal: 1,
        errors: [
          {
            message: 'abc',
            path: 'a.b',
          },
        ],
      });
      t.has(r.operations[1]?.execution, {
        ok: true,
        errorsTotal: 0,
        errors: [],
      });
    },
  });

  const opDef = {
    fields: ['fieldA'],
    key: 'abc',
    operation: 'query me {}',
    operationName: 'opName',
  };

  const finish1 = usageColl.collect(opDef);
  const finish2 = usageColl.collect(opDef);

  await Promise.all([
    finish1({
      ok: false,
      errors: [{ message: 'abc', path: ['a', 'b'] }],
    }),
    finish2({
      ok: true,
    }),
  ]);
});

test('disposes', async () => {
  const ee = new EventEmitter();
  const usageColl = createUsageCollector({
    sendInterval: 50,
    send: async () => {
      ee.emit('send');
    },
  });

  const opDef = {
    fields: ['fieldA'],
    key: 'abc',
    operation: 'query me {}',
    operationName: 'opName',
  };

  usageColl.collect(opDef)({
    ok: true,
  });

  const p = once(ee, 'send');
  await usageColl.dispose();
  await p;
});
