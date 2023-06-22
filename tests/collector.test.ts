import { buildSchema, parse } from 'graphql';
import { createCollector } from '../src';
import { test } from 'tap';

const schema = buildSchema(/* GraphQL */ `
  type Query {
    project(selector: ProjectSelectorInput!): Project
    projectsByType(type: ProjectType!): [Project!]!
    projects(filter: FilterInput): [Project!]!
  }

  type Mutation {
    deleteProject(selector: ProjectSelectorInput!): DeleteProjectPayload!
  }

  input ProjectSelectorInput {
    organization: ID!
    project: ID!
  }

  input FilterInput {
    type: ProjectType
    pagination: PaginationInput
    order: [ProjectOrderByInput!]
  }

  input PaginationInput {
    limit: Int
    offset: Int
  }

  input ProjectOrderByInput {
    field: String!
    direction: OrderDirection
  }

  enum OrderDirection {
    ASC
    DESC
  }

  type ProjectSelector {
    organization: ID!
    project: ID!
  }

  type DeleteProjectPayload {
    selector: ProjectSelector!
    deletedProject: Project!
  }

  type Project {
    id: ID!
    cleanId: ID!
    name: String!
    type: ProjectType!
    buildUrl: String
    validationUrl: String
  }

  enum ProjectType {
    FEDERATION
    STITCHING
    SINGLE
    CUSTOM
  }
`);

const op = parse(/* GraphQL */ `
  mutation deleteProject($selector: ProjectSelectorInput!) {
    deleteProject(selector: $selector) {
      selector {
        organization
        project
      }
      deletedProject {
        ...ProjectFields
      }
    }
  }

  fragment ProjectFields on Project {
    id
    cleanId
    name
    type
  }
`);

test('collect fields', async (t) => {
  const collect = createCollector(schema);
  const info = collect(op, {});

  t.ok(info.fields.includes(`Mutation.deleteProject`));
  t.ok(info.fields.includes(`Project.id`));
  t.equal(info.operationName, 'deleteProject');
});

test('collect input object types', async (t) => {
  const collect = createCollector(schema);
  const info = collect(op, {});

  t.ok(info.fields.includes(`ProjectSelectorInput.organization`));
  t.ok(info.fields.includes(`ProjectSelectorInput.project`));
});

test('collect enums and scalars as inputs', async (t) => {
  const collect = createCollector(schema);
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($limit: Int!, $type: ProjectType!) {
        projects(filter: { pagination: { limit: $limit }, type: $type }) {
          id
        }
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`Int`));
  t.ok(info.fields.includes(`ProjectType.FEDERATION`));
  t.ok(info.fields.includes(`ProjectType.STITCHING`));
  t.ok(info.fields.includes(`ProjectType.SINGLE`));
  t.ok(info.fields.includes(`ProjectType.CUSTOM`));

  t.equal(info.operationName, 'getProjects');
});

test('collect enum values from object fields', async (t) => {
  const collect = createCollector(schema, {});
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($limit: Int!) {
        projects(filter: { pagination: { limit: $limit }, type: FEDERATION }) {
          id
        }
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`Int`));
  t.ok(info.fields.includes(`ProjectType.FEDERATION`));
  t.notOk(info.fields.includes(`ProjectType.STITCHING`));
  t.notOk(info.fields.includes(`ProjectType.SINGLE`));
  t.notOk(info.fields.includes(`ProjectType.CUSTOM`));
});

test('collect enum values from arguments', async (t) => {
  const collect = createCollector(schema);
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects {
        projectsByType(type: FEDERATION) {
          id
        }
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`ProjectType.FEDERATION`));
  t.notOk(info.fields.includes(`ProjectType.STITCHING`));
  t.notOk(info.fields.includes(`ProjectType.SINGLE`));
  t.notOk(info.fields.includes(`ProjectType.CUSTOM`));
});

test('collect arguments', async (t) => {
  const collect = createCollector(schema);
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($limit: Int!, $type: ProjectType!) {
        projects(filter: { pagination: { limit: $limit }, type: $type }) {
          id
        }
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`Query.projects.filter`));
});

test('skips argument directives', async (t) => {
  const collect = createCollector(schema);

  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($limit: Int!, $type: ProjectType!, $includeName: Boolean!) {
        projects(filter: { pagination: { limit: $limit }, type: $type }) {
          id
          ...NestedFragment
        }
      }

      fragment NestedFragment on Project {
        ...IncludeNameFragment @include(if: $includeName)
      }

      fragment IncludeNameFragment on Project {
        name
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`Query.projects.filter`));
});

test('collect used-only input fields', async (t) => {
  const collect = createCollector(schema);
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($limit: Int!, $type: ProjectType!) {
        projects(filter: { pagination: { limit: $limit }, type: $type }) {
          id
        }
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`FilterInput.type`));
  t.ok(info.fields.includes(`FilterInput.pagination`));
  t.ok(info.fields.includes(`PaginationInput.limit`));
  t.notOk(info.fields.includes(`PaginationInput.offset`));
});

test('collect all input fields when `processVariables` has not been passed and input is passed as a variable', async (t) => {
  const collect = createCollector(schema);
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($pagination: PaginationInput!, $type: ProjectType!) {
        projects(filter: { pagination: $pagination, type: $type }) {
          id
        }
      }
    `),
    {}
  );

  t.ok(info.fields.includes(`FilterInput.pagination`));
  t.ok(info.fields.includes(`FilterInput.type`));
  t.ok(info.fields.includes(`PaginationInput.limit`));
  t.ok(info.fields.includes(`PaginationInput.offset`));
});

test('(processVariables: true) collect used-only input fields', async (t) => {
  const collect = createCollector(schema, {
    processVariables: true,
  });
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($pagination: PaginationInput!, $type: ProjectType!) {
        projects(filter: { pagination: $pagination, type: $type }) {
          id
        }
      }
    `),
    {
      pagination: {
        limit: 1,
      },
      type: 'STITCHING',
    }
  );

  t.ok(info.fields.includes(`FilterInput.pagination`));
  t.ok(info.fields.includes(`FilterInput.type`));
  t.ok(info.fields.includes(`PaginationInput.limit`));
  t.notOk(info.fields.includes(`PaginationInput.offset`));
});

test('(processVariables: true) should collect input object without fields when corresponding variable is not provided', async (t) => {
  const collect = createCollector(schema, {
    processVariables: true,
  });
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($pagination: PaginationInput, $type: ProjectType!) {
        projects(filter: { pagination: $pagination, type: $type }) {
          id
        }
      }
    `),
    {
      type: 'STITCHING',
    }
  );

  t.ok(info.fields.includes(`FilterInput.pagination`));
  t.ok(info.fields.includes(`FilterInput.type`));
  t.ok(info.fields.includes(`PaginationInput`));

  t.notOk(info.fields.includes(`PaginationInput.offset`));
  t.notOk(info.fields.includes(`PaginationInput.limit`));
});

test('(processVariables: true) collect used-only input type fields from an array', async (t) => {
  const collect = createCollector(schema, {
    processVariables: true,
  });
  const info = collect(
    parse(/* GraphQL */ `
      query getProjects($filter: FilterInput) {
        projects(filter: $filter) {
          id
        }
      }
    `),
    {
      filter: {
        order: [
          {
            field: 'name',
          },
          {
            field: 'buildUrl',
            direction: 'DESC',
          },
        ],
        pagination: {
          limit: 10,
        },
      },
    }
  );

  t.ok(info.fields.includes(`FilterInput.pagination`));
  t.ok(info.fields.includes(`PaginationInput.limit`));
  t.ok(info.fields.includes(`FilterInput.order`));
  t.ok(info.fields.includes(`ProjectOrderByInput.field`));
  t.ok(info.fields.includes(`ProjectOrderByInput.direction`));

  t.notOk(info.fields.includes(`FilterInput.type`));
  t.notOk(info.fields.includes(`PaginationInput.offset`));
});
