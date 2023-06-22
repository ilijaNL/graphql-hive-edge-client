import {
  ArgumentNode,
  DocumentNode,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLSchema,
  GraphQLType,
  GraphQLUnionType,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  Kind,
  ObjectFieldNode,
  OperationDefinitionNode,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from 'graphql';
import { normalizeOperation } from '@graphql-hive/core';
import { OperationDefinition } from './usage';

const createNodeHashFn = () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  return (item: string): string => crypto.createHash('md5').update(item).digest('hex');
};

function makeId(...names: string[]): string {
  return names.join('.');
}

function markAsUsed(id: string, entries: Set<string>) {
  if (!entries.has(id)) {
    entries.add(id);
  }
}

export const createCollector = (
  schema: GraphQLSchema,
  opts?: {
    processVariables?: boolean;
    keyHashFn?: (item: string) => string;
  }
) => {
  const typeInfo = new TypeInfo(schema);
  const processVariables = opts?.processVariables;
  const hashingFn = opts?.keyHashFn ?? createNodeHashFn();

  return function collect(
    doc: DocumentNode,
    variables: {
      [key: string]: unknown;
    } | null
  ): OperationDefinition {
    const entries = new Set<string>();
    const collected_entire_named_types = new Set<string>();
    const shouldAnalyzeVariableValues = processVariables === true && variables !== null;

    const collectedInputTypes: Record<
      string,
      {
        all: boolean;
        fields: Set<string>;
      }
    > = {};

    function collectInputType(inputType: string, fieldName?: string) {
      if (!collectedInputTypes[inputType]) {
        collectedInputTypes[inputType] = {
          all: false,
          fields: new Set<string>(),
        };
      }

      if (fieldName) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        collectedInputTypes[inputType]!.fields.add(fieldName);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        collectedInputTypes[inputType]!.all = true;
      }
    }

    function collectNode(node: ObjectFieldNode | ArgumentNode) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const inputType = typeInfo.getInputType()!;
      const inputTypeName = resolveTypeName(inputType);

      if (node.value.kind === Kind.ENUM) {
        // Collect only a specific enum value
        collectInputType(inputTypeName, node.value.value);
      } else if (node.value.kind !== Kind.OBJECT && node.value.kind !== Kind.LIST) {
        // When processing of variables is enabled,
        // we want to skip collecting full input types of variables
        // and only collect specific fields.
        // That's why the following condition is added.
        // Otherwise we would mark entire input types as used, and not granular fields.
        if (node.value.kind === Kind.VARIABLE && shouldAnalyzeVariableValues) {
          return;
        }

        collectInputType(inputTypeName);
      }
    }

    function markEntireTypeAsUsed(type: GraphQLInputType): void {
      const namedType = unwrapType(type);

      if (collected_entire_named_types.has(namedType.name)) {
        // No need to mark this type as used again
        return;
      }
      // Add this type to the set of types that have been marked as used
      // to avoid infinite loops
      collected_entire_named_types.add(namedType.name);

      if (isScalarType(namedType)) {
        markAsUsed(makeId(namedType.name), entries);
        return;
      }

      if (isEnumType(namedType)) {
        namedType.getValues().forEach((value) => {
          markAsUsed(makeId(namedType.name, value.name), entries);
        });
        return;
      }

      const fieldsMap = namedType.getFields();

      for (const fieldName in fieldsMap) {
        const field = fieldsMap[fieldName];

        if (field) {
          markAsUsed(makeId(namedType.name, field.name), entries);
          markEntireTypeAsUsed(field.type);
        }
      }
    }

    function collectVariable(namedType: GraphQLNamedInputType, variableValue: unknown) {
      const variableValueArray = Array.isArray(variableValue) ? variableValue : [variableValue];
      if (isInputObjectType(namedType)) {
        variableValueArray.forEach((variable) => {
          if (variable) {
            // Collect only the used fields
            for (const fieldName in variable) {
              const field = namedType.getFields()[fieldName];
              if (field) {
                collectInputType(namedType.name, fieldName);
                collectVariable(unwrapType(field.type), variable[fieldName]);
              }
            }
          } else {
            // Collect type without fields
            markAsUsed(makeId(namedType.name), entries);
          }
        });
      } else {
        collectInputType(namedType.name);
      }
    }

    visit(
      doc,
      visitWithTypeInfo(typeInfo, {
        Field() {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const parent = typeInfo.getParentType()!;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const field = typeInfo.getFieldDef()!;

          markAsUsed(makeId(parent.name, field.name), entries);
        },
        VariableDefinition(node) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const inputType = typeInfo.getInputType()!;

          if (shouldAnalyzeVariableValues) {
            // Granular collection of variable values is enabled
            const variableName = node.variable.name.value;
            const variableValue = variables[variableName];
            const namedType = unwrapType(inputType);

            collectVariable(namedType, variableValue);
          } else {
            // Collect the entire type without processing the variables
            collectInputType(resolveTypeName(inputType));
          }
        },
        Directive(node) {
          return {
            ...node,
            arguments: [],
          };
        },
        Argument(node) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const parent = typeInfo.getParentType()!;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const field = typeInfo.getFieldDef()!;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const arg = typeInfo.getArgument()!;

          markAsUsed(makeId(parent.name, field.name, arg.name), entries);
          collectNode(node);
        },
        ListValue(node) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const inputType = typeInfo.getInputType()!;
          const inputTypeName = resolveTypeName(inputType);

          node.values.forEach((value) => {
            if (value.kind !== Kind.OBJECT) {
              // if a value is not an object we need to collect all fields
              collectInputType(inputTypeName);
            }
          });
        },
        ObjectField(node) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const parentInputType = typeInfo.getParentInputType()!;
          const parentInputTypeName = resolveTypeName(parentInputType);

          collectNode(node);
          collectInputType(parentInputTypeName, node.name.value);
        },
      })
    );

    for (const inputTypeName in collectedInputTypes) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { fields, all } = collectedInputTypes[inputTypeName]!;

      if (all) {
        markEntireTypeAsUsed(schema.getType(inputTypeName) as any);
      } else {
        fields.forEach((field) => {
          markAsUsed(makeId(inputTypeName, field), entries);
        });
      }
    }

    const document = normalizeOperation({
      document: doc,
      hideLiterals: true,
      removeAliases: true,
    });

    const opDef = doc.definitions.find(
      (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION
    );

    return {
      key: hashingFn(JSON.stringify(document)),
      operationName: opDef?.name?.value,
      operation: document,
      fields: Array.from(entries),
    };
  };
};

function resolveTypeName(inputType: GraphQLType): string {
  return unwrapType(inputType).name;
}

function unwrapType(type: GraphQLInputType): GraphQLNamedInputType;
function unwrapType(type: GraphQLOutputType): GraphQLNamedOutputType;
function unwrapType(type: GraphQLType): GraphQLNamedType;
function unwrapType(type: GraphQLType): GraphQLNamedType {
  if (isNonNullType(type) || isListType(type)) {
    return unwrapType(type.ofType);
  }

  return type;
}

type GraphQLNamedInputType = Exclude<GraphQLNamedType, GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType>;
type GraphQLNamedOutputType = Exclude<GraphQLNamedType, GraphQLInputObjectType>;
