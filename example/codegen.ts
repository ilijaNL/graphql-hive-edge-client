import type { CodegenConfig } from '@graphql-codegen/cli';
import { GenerateFn } from 'graphql-codegen-on-operations';
import { createCollector } from 'graphql-hive-edge-client';

const genFn: GenerateFn = (schema, { documents }) => {
  const collect = createCollector(schema);
  const result = documents.map((d) => collect(d.node, null));

  return JSON.stringify(result, null, 2);
};

const config: CodegenConfig = {
  schema: './schema.graphql',
  documents: ['src/**/*.{ts,tsx,graphql}'],
  ignoreNoDocuments: true,
  generates: {
    './src/__generated__/hive-ops.json': {
      plugins: ['graphql-codegen-on-operations'],
      config: {
        gen: genFn,
      },
    },
  },
};
export default config;
